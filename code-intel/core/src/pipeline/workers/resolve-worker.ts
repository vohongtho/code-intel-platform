/**
 * resolve-worker.ts — Worker thread for the resolve phase.
 *
 * Receives ResolveTask (file + extracted symbols) and returns resolved
 * import/call/heritage edges. Graph read-only snapshot is passed via
 * workerData at startup.
 */
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { detectLanguage } from '../../shared/index.js';
import type { CodeEdge, EdgeKind } from '../../shared/index.js';
import { generateEdgeId, generateNodeId } from '../../graph/id-generator.js';

export interface ResolveSnapshot {
  /** filePath (relative) → nodeId, for all symbol nodes */
  symbolIndex: Record<string, string>;
  /** relativePath → { name → nodeId } */
  fileSymbolIndex: Record<string, Record<string, string>>;
  /** relative filePath → absolute path (file index) */
  fileIndex: Record<string, string>;
  workspaceRoot: string;
}

export interface ResolveTask {
  taskId: string;
  filePath: string;      // absolute
  relativePath: string;
  fileNodeId: string;
  source: string;
  /** Sorted function list for enclosing-function lookup */
  funcList: { id: string; startLine: number; endLine: number | undefined }[];
}

export interface ResolveResult {
  taskId: string;
  edges: CodeEdge[];
  error?: string;
}

// ─── Helpers (inline to avoid importing main-thread modules) ──────────────────

const CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw',
  'typeof', 'instanceof', 'delete', 'void', 'new', 'import', 'export',
  'from', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
  'extends', 'implements',
]);

interface ParsedImport { rawPath: string; localNames: string[]; isDefault: boolean; line: number }
interface ParsedCall { name: string; isNew: boolean; line: number }
interface ParsedHeritage { className: string; extendsNames: string[]; implementsNames: string[] }

function extractImports(lines: string[], isPython: boolean): ParsedImport[] {
  const imports: ParsedImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const tsImport = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
    if (tsImport) {
      const names: string[] = [];
      const namedMatch = line.match(/\{([^}]+)\}/);
      if (namedMatch) names.push(...namedMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean));
      const defaultMatch = line.match(/import\s+(\w+)/);
      if (defaultMatch && defaultMatch[1] !== 'type') names.push(defaultMatch[1]);
      imports.push({ rawPath: tsImport[1], localNames: names, isDefault: !namedMatch, line: i + 1 });
      continue;
    }
    if (isPython) {
      const fromImport = line.match(/from\s+([\w.]+)\s+import\s+(.+)/);
      if (fromImport) {
        const names = fromImport[2].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
        imports.push({ rawPath: fromImport[1], localNames: names, isDefault: false, line: i + 1 });
        continue;
      }
      const directImport = line.match(/^import\s+([\w.]+)(?:\s+as\s+(\w+))?/);
      if (directImport) {
        imports.push({ rawPath: directImport[1], localNames: [directImport[2] ?? directImport[1].split('.').pop()!], isDefault: false, line: i + 1 });
        continue;
      }
    }
    const javaImport = line.match(/^import\s+(?:static\s+)?([\w.]+)/);
    if (javaImport && !line.includes('from')) {
      const parts = javaImport[1].split('.');
      imports.push({ rawPath: javaImport[1], localNames: [parts[parts.length - 1]], isDefault: false, line: i + 1 });
      continue;
    }
    const rustUse = line.match(/^use\s+([\w:]+)/);
    if (rustUse) {
      const parts = rustUse[1].split('::');
      imports.push({ rawPath: rustUse[1], localNames: [parts[parts.length - 1]], isDefault: false, line: i + 1 });
    }
    const requireMatch = line.match(/require\s+['"]([^'"]+)['"]/);
    if (requireMatch) imports.push({ rawPath: requireMatch[1], localNames: [], isDefault: false, line: i + 1 });
  }
  return imports;
}

function extractCalls(lines: string[]): ParsedCall[] {
  const calls: ParsedCall[] = [];
  const callRegex = /(?:new\s+)?(\w+)\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(export\s+)?(async\s+)?function\s/.test(line)) continue;
    if (/^\s*(export\s+)?(abstract\s+)?class\s/.test(line)) continue;
    if (/^\s*(export\s+)?interface\s/.test(line)) continue;
    if (/^\s*(export\s+)?enum\s/.test(line)) continue;
    if (/^\s*import\s/.test(line)) continue;
    if (/^\s*\/\//.test(line)) continue;
    let match;
    callRegex.lastIndex = 0;
    while ((match = callRegex.exec(line)) !== null) {
      const name = match[1];
      if (CALL_KEYWORDS.has(name)) continue;
      const isNew = line.substring(Math.max(0, match.index - 4), match.index).includes('new');
      calls.push({ name, isNew, line: i + 1 });
    }
    const memberCallRegex = /(\w+)\.(\w+)\s*\(/g;
    memberCallRegex.lastIndex = 0;
    while ((match = memberCallRegex.exec(line)) !== null) {
      calls.push({ name: match[2], isNew: false, line: i + 1 });
    }
  }
  return calls;
}

function extractHeritage(lines: string[]): ParsedHeritage[] {
  const heritages: ParsedHeritage[] = [];
  for (const line of lines) {
    const classMatch = line.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
    if (classMatch) {
      heritages.push({ className: classMatch[1], extendsNames: classMatch[2] ? [classMatch[2]] : [], implementsNames: classMatch[3] ? classMatch[3].split(',').map((n) => n.trim()).filter(Boolean) : [] });
      continue;
    }
    const pyClassMatch = line.match(/class\s+(\w+)\(([^)]+)\)/);
    if (pyClassMatch) {
      const bases = pyClassMatch[2].split(',').map((n) => n.trim()).filter(Boolean);
      heritages.push({ className: pyClassMatch[1], extendsNames: bases, implementsNames: [] });
    }
  }
  return heritages;
}

function findEnclosingFunction(funcs: { id: string; startLine: number; endLine: number | undefined }[], line: number): string | null {
  let lo = 0; let hi = funcs.length - 1; let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const fn = funcs[mid];
    if (fn.startLine <= line) {
      if (fn.endLine === undefined || line <= fn.endLine) best = fn.id;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

// ─── Message handler ──────────────────────────────────────────────────────────

if (!parentPort) throw new Error('resolve-worker must be run as a Worker thread');

const snapshot = workerData as ResolveSnapshot;
const { symbolIndex, fileSymbolIndex, fileIndex, workspaceRoot } = snapshot;

parentPort.on('message', (task: ResolveTask) => {
  try {
    const edges: CodeEdge[] = [];
    const lang = detectLanguage(task.filePath);
    if (!lang) {
      parentPort!.postMessage({ taskId: task.taskId, edges } as ResolveResult);
      return;
    }

    const lines = task.source.split('\n');
    const isPython = task.relativePath.endsWith('.py');
    const imports = extractImports(lines, isPython);
    const calls = extractCalls(lines);
    const heritages = extractHeritage(lines);
    const localSymbols = fileSymbolIndex[task.relativePath] ?? {};

    // Imports
    for (const imp of imports) {
      const cleaned = imp.rawPath.replace(/['"]/g, '');
      let resolvedRelPath: string | null = null;
      if (cleaned.startsWith('.')) {
        const cleanedNoJs = cleaned.replace(/\.(js|jsx)$/, '');
        const fromDir = path.dirname(task.relativePath);
        for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '/index.ts', '/index.js']) {
          const candidate = path.normalize(path.join(fromDir, cleanedNoJs + ext));
          if (fileIndex[candidate]) { resolvedRelPath = candidate; break; }
        }
      } else {
        for (const ext of ['', '.ts', '.js', '.py', '.java', '.go']) {
          if (fileIndex[cleaned + ext]) { resolvedRelPath = cleaned + ext; break; }
        }
      }
      if (resolvedRelPath) {
        const targetFileId = generateNodeId('file', resolvedRelPath, resolvedRelPath);
        const edgeId = generateEdgeId(task.fileNodeId, targetFileId, 'imports');
        edges.push({ id: edgeId, source: task.fileNodeId, target: targetFileId, kind: 'imports', weight: 0.95, label: cleaned });
      }
    }

    // Calls
    for (const call of calls) {
      let targetId = localSymbols[call.name];
      let confidence = 0.95;
      if (!targetId) { targetId = symbolIndex[call.name]; confidence = 0.5; }
      if (targetId) {
        const callerNodeId = task.funcList.length > 0 ? findEnclosingFunction(task.funcList, call.line) : null;
        const sourceId = callerNodeId ?? task.fileNodeId;
        if (sourceId !== targetId) {
          const edgeId = generateEdgeId(sourceId, targetId, 'calls');
          edges.push({ id: edgeId, source: sourceId, target: targetId, kind: 'calls', weight: confidence, label: call.name });
        }
      }
    }

    // Heritage
    for (const h of heritages) {
      const classNodeId = localSymbols[h.className] ?? symbolIndex[h.className];
      if (!classNodeId) continue;
      for (const ext of h.extendsNames) {
        const targetId = symbolIndex[ext];
        if (targetId) edges.push({ id: generateEdgeId(classNodeId, targetId, 'extends'), source: classNodeId, target: targetId, kind: 'extends', weight: 1.0, label: `extends ${ext}` });
      }
      for (const impl of h.implementsNames) {
        const targetId = symbolIndex[impl];
        if (targetId) edges.push({ id: generateEdgeId(classNodeId, targetId, 'implements'), source: classNodeId, target: targetId, kind: 'implements', weight: 1.0, label: `implements ${impl}` });
      }
    }

    parentPort!.postMessage({ taskId: task.taskId, edges } as ResolveResult);
  } catch (err) {
    parentPort!.postMessage({ taskId: task.taskId, edges: [], error: err instanceof Error ? err.message : String(err) } as ResolveResult);
  }
});
