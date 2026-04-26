import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';
import type { CodeEdge } from '../../shared/index.js';
import { getLanguageModule } from '../../languages/registry.js';

interface ParsedImport {
  rawPath: string;
  localNames: string[];
  isDefault: boolean;
  line: number;
}

interface ParsedCall {
  name: string;
  receiverText?: string;
  isNew: boolean;
  line: number;
}

interface ParsedHeritage {
  className: string;
  extendsNames: string[];
  implementsNames: string[];
}

export const resolvePhase: Phase = {
  name: 'resolve',
  dependencies: ['parse'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const { graph, workspaceRoot, filePaths } = context;

    let importEdges = 0;
    let callEdges = 0;
    let heritageEdges = 0;

    // Build file index for import resolution
    const fileIndex = new Map<string, string>();
    for (const fp of filePaths) {
      const rel = path.relative(workspaceRoot, fp);
      fileIndex.set(rel, fp);
      // Index without extension
      const noExt = rel.replace(/\.\w+$/, '');
      if (!fileIndex.has(noExt)) fileIndex.set(noExt, fp);
      // Index basename
      const base = path.basename(rel, path.extname(rel));
      if (!fileIndex.has(base)) fileIndex.set(base, fp);
    }

    // Build symbol index: name → nodeId
    const symbolIndex = new Map<string, string>();
    const fileSymbolIndex = new Map<string, Map<string, string>>();
    for (const node of graph.allNodes()) {
      if (['function', 'class', 'interface', 'method', 'enum', 'type_alias', 'variable', 'constant', 'struct', 'trait'].includes(node.kind)) {
        symbolIndex.set(node.name, node.id);
        let fileMap = fileSymbolIndex.get(node.filePath);
        if (!fileMap) {
          fileMap = new Map();
          fileSymbolIndex.set(node.filePath, fileMap);
        }
        fileMap.set(node.name, node.id);
      }
    }

    // Process each file for imports, calls, heritage
    for (const filePath of filePaths) {
      const lang = detectLanguage(filePath);
      if (!lang) continue;

      const relativePath = path.relative(workspaceRoot, filePath);
      const fileNodeId = generateNodeId('file', relativePath, relativePath);

      let source: string;
      try {
        source = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const lines = source.split('\n');
      const imports = extractImports(lines, lang === 'python');
      const calls = extractCalls(lines);
      const heritages = extractHeritage(lines);

      // Resolve imports → IMPORTS edges
      for (const imp of imports) {
        const cleaned = imp.rawPath.replace(/['"]/g, '');
        let resolvedRelPath: string | null = null;

        if (cleaned.startsWith('.')) {
          // Relative import — strip .js/.jsx since TS imports use .js but files are .ts
          const cleanedNoJs = cleaned.replace(/\.(js|jsx)$/, '');
          const fromDir = path.dirname(relativePath);
          for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '/index.ts', '/index.js']) {
            const candidate = path.join(fromDir, cleanedNoJs + ext);
            const normalized = path.normalize(candidate);
            if (fileIndex.has(normalized)) {
              // Use the absolute path from the index to derive the canonical relative path
              const absPath = fileIndex.get(normalized)!;
              resolvedRelPath = path.relative(workspaceRoot, absPath);
              break;
            }
          }
        } else {
          // Package import — try to find in file index
          for (const ext of ['', '.ts', '.js', '.py', '.java', '.go']) {
            if (fileIndex.has(cleaned + ext)) {
              resolvedRelPath = cleaned + ext;
              break;
            }
          }
          // Try path-based
          const asPath = cleaned.replace(/\./g, '/');
          for (const ext of ['', '.ts', '.js', '.py', '.java', '.go', '/index.ts', '/__init__.py']) {
            if (fileIndex.has(asPath + ext)) {
              resolvedRelPath = asPath + ext;
              break;
            }
          }
        }

        if (resolvedRelPath) {
          const targetFileId = generateNodeId('file', resolvedRelPath, resolvedRelPath);
          if (graph.getNode(targetFileId)) {
            const edgeId = generateEdgeId(fileNodeId, targetFileId, 'imports');
            if (!graph.getEdge(edgeId)) {
              graph.addEdge({
                id: edgeId,
                source: fileNodeId,
                target: targetFileId,
                kind: 'imports',
                weight: 0.95,
                label: cleaned,
              });
              importEdges++;
            }
          }
        }
      }

      // Resolve calls → CALLS edges
      const localSymbols = fileSymbolIndex.get(relativePath);
      for (const call of calls) {
        // Tier 1: same file
        let targetId = localSymbols?.get(call.name);
        let confidence = 0.95;

        if (!targetId) {
          // Tier 2: global
          targetId = symbolIndex.get(call.name);
          confidence = 0.5;
        }

        if (targetId) {
          // Find the caller (enclosing function)
          const callerNodeId = findEnclosingFunction(graph, relativePath, call.line);
          const sourceId = callerNodeId ?? fileNodeId;

          if (sourceId !== targetId) {
            const edgeId = generateEdgeId(sourceId, targetId, 'calls');
            if (!graph.getEdge(edgeId)) {
              graph.addEdge({
                id: edgeId,
                source: sourceId,
                target: targetId,
                kind: 'calls',
                weight: confidence,
                label: call.name,
              });
              callEdges++;
            }
          }
        }
      }

      // Heritage → EXTENDS/IMPLEMENTS edges
      for (const h of heritages) {
        const classNodeId = localSymbols?.get(h.className) ?? symbolIndex.get(h.className);
        if (!classNodeId) continue;

        for (const ext of h.extendsNames) {
          const targetId = symbolIndex.get(ext);
          if (targetId) {
            const edgeId = generateEdgeId(classNodeId, targetId, 'extends');
            if (!graph.getEdge(edgeId)) {
              graph.addEdge({
                id: edgeId,
                source: classNodeId,
                target: targetId,
                kind: 'extends',
                weight: 1.0,
                label: `extends ${ext}`,
              });
              heritageEdges++;
            }
          }
        }

        for (const impl of h.implementsNames) {
          const targetId = symbolIndex.get(impl);
          if (targetId) {
            const edgeId = generateEdgeId(classNodeId, targetId, 'implements');
            if (!graph.getEdge(edgeId)) {
              graph.addEdge({
                id: edgeId,
                source: classNodeId,
                target: targetId,
                kind: 'implements',
                weight: 1.0,
                label: `implements ${impl}`,
              });
              heritageEdges++;
            }
          }
        }
      }
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Resolved ${importEdges} imports, ${callEdges} calls, ${heritageEdges} heritage edges. Graph: ${graph.size.nodes} nodes, ${graph.size.edges} edges`,
    };
  },
};

function extractImports(lines: string[], isPython: boolean): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // TypeScript/JavaScript: import ... from '...'
    const tsImport = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
    if (tsImport) {
      const names: string[] = [];
      const namedMatch = line.match(/\{([^}]+)\}/);
      if (namedMatch) {
        names.push(...namedMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean));
      }
      const defaultMatch = line.match(/import\s+(\w+)/);
      if (defaultMatch && defaultMatch[1] !== 'type') {
        names.push(defaultMatch[1]);
      }
      imports.push({
        rawPath: tsImport[1],
        localNames: names,
        isDefault: !namedMatch,
        line: i + 1,
      });
      continue;
    }

    // Python: from X import Y / import X
    if (isPython) {
      const fromImport = line.match(/from\s+([\w.]+)\s+import\s+(.+)/);
      if (fromImport) {
        const names = fromImport[2].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);
        imports.push({ rawPath: fromImport[1], localNames: names, isDefault: false, line: i + 1 });
        continue;
      }
      const directImport = line.match(/^import\s+([\w.]+)(?:\s+as\s+(\w+))?/);
      if (directImport) {
        imports.push({
          rawPath: directImport[1],
          localNames: [directImport[2] ?? directImport[1].split('.').pop()!],
          isDefault: false,
          line: i + 1,
        });
        continue;
      }
    }

    // Java/Kotlin: import com.example.Foo
    const javaImport = line.match(/^import\s+(?:static\s+)?([\w.]+)/);
    if (javaImport && !line.includes('from')) {
      const parts = javaImport[1].split('.');
      imports.push({
        rawPath: javaImport[1],
        localNames: [parts[parts.length - 1]],
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Go: import "path"
    const goImport = line.match(/^\s*"([^"]+)"/);
    if (goImport && (i > 0 && lines[i - 1]?.includes('import') || line.match(/^import\s+"/))) {
      const parts = goImport[1].split('/');
      imports.push({
        rawPath: goImport[1],
        localNames: [parts[parts.length - 1]],
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // C/C++: #include
    const includeMatch = line.match(/#include\s+[<"]([^>"]+)[>"]/);
    if (includeMatch) {
      imports.push({
        rawPath: includeMatch[1],
        localNames: [],
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Rust: use crate::... / use super::...
    const rustUse = line.match(/^use\s+([\w:]+)/);
    if (rustUse) {
      const parts = rustUse[1].split('::');
      imports.push({
        rawPath: rustUse[1],
        localNames: [parts[parts.length - 1]],
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // C#: using
    const usingMatch = line.match(/^using\s+([\w.]+)/);
    if (usingMatch) {
      const parts = usingMatch[1].split('.');
      imports.push({
        rawPath: usingMatch[1],
        localNames: [parts[parts.length - 1]],
        isDefault: false,
        line: i + 1,
      });
    }

    // Ruby: require
    const requireMatch = line.match(/require\s+['"]([^'"]+)['"]/);
    if (requireMatch) {
      imports.push({
        rawPath: requireMatch[1],
        localNames: [],
        isDefault: false,
        line: i + 1,
      });
    }
  }

  return imports;
}

function extractCalls(lines: string[]): ParsedCall[] {
  const calls: ParsedCall[] = [];
  const callRegex = /(?:new\s+)?(\w+)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip declarations
    if (/^\s*(export\s+)?(async\s+)?function\s/.test(line)) continue;
    if (/^\s*(export\s+)?(abstract\s+)?class\s/.test(line)) continue;
    if (/^\s*(export\s+)?interface\s/.test(line)) continue;
    if (/^\s*(export\s+)?enum\s/.test(line)) continue;
    if (/^\s*(export\s+)?type\s+\w+\s*=/.test(line)) continue;
    if (/^\s*import\s/.test(line)) continue;
    if (/^\s*\/\//.test(line)) continue;

    let match;
    callRegex.lastIndex = 0;
    while ((match = callRegex.exec(line)) !== null) {
      const name = match[1];
      // Skip language keywords
      if (['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'typeof', 'instanceof', 'delete', 'void', 'new', 'import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'extends', 'implements'].includes(name)) continue;
      const isNew = line.substring(Math.max(0, match.index - 4), match.index).includes('new');
      calls.push({ name, isNew, line: i + 1 });
    }

    // Member calls: receiver.method(
    const memberCallRegex = /(\w+)\.(\w+)\s*\(/g;
    memberCallRegex.lastIndex = 0;
    while ((match = memberCallRegex.exec(line)) !== null) {
      calls.push({
        name: match[2],
        receiverText: match[1],
        isNew: false,
        line: i + 1,
      });
    }
  }

  return calls;
}

function extractHeritage(lines: string[]): ParsedHeritage[] {
  const heritages: ParsedHeritage[] = [];

  for (const line of lines) {
    // class Foo extends Bar implements Baz, Qux
    const classMatch = line.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
    if (classMatch) {
      const extendsNames = classMatch[2] ? [classMatch[2]] : [];
      const implementsNames = classMatch[3] ? classMatch[3].split(',').map((n) => n.trim()).filter(Boolean) : [];
      heritages.push({ className: classMatch[1], extendsNames, implementsNames });
      continue;
    }

    // Python: class Foo(Bar, Baz):
    const pyClassMatch = line.match(/class\s+(\w+)\(([^)]+)\)/);
    if (pyClassMatch) {
      const bases = pyClassMatch[2].split(',').map((n) => n.trim()).filter(Boolean);
      heritages.push({ className: pyClassMatch[1], extendsNames: bases, implementsNames: [] });
    }
  }

  return heritages;
}

function findEnclosingFunction(
  graph: import('../../graph/knowledge-graph.js').KnowledgeGraph,
  filePath: string,
  line: number,
): string | null {
  let best: { id: string; startLine: number } | null = null;

  for (const node of graph.allNodes()) {
    if (node.filePath !== filePath) continue;
    if (!['function', 'method'].includes(node.kind)) continue;
    if (!node.startLine) continue;
    if (node.startLine <= line) {
      if (!best || node.startLine > best.startLine) {
        best = { id: node.id, startLine: node.startLine };
      }
    }
  }

  return best?.id ?? null;
}
