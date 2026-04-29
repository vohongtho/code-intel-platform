/**
 * parse-worker.ts — Worker thread for the parse phase.
 *
 * Receives ParseTask messages, parses one file at a time (tree-sitter or
 * regex fallback), and posts ParseResult back to the parent thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { Language, detectLanguage } from '../../shared/index.js';
import type { CodeNode, CodeEdge } from '../../shared/index.js';
import { parseSource, getLanguage } from '../../parsing/parser-manager.js';
import { runQueryMatches } from '../../parsing/query-runner.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';
import Logger from '../../shared/logger.js';
import type { Node as TSNode, Language as TSLanguage } from 'web-tree-sitter';

export interface ParseTask {
  taskId: string;
  filePath: string;     // absolute
  relativePath: string;
  source: string;
  lang: string;         // Language enum value (string)
  fileNodeId: string;
  queryStr: string | null;
}

export interface ParseResult {
  taskId: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
  usedTreeSitter: boolean;
  error?: string;
}

// ─── Capture-name → NodeKind (duplicated here to avoid shared-state issues) ──
import type { NodeKind } from '../../shared/index.js';

const CAPTURE_KIND: Record<string, NodeKind> = {
  'def.func': 'function', 'def.func.decorated': 'function',
  'def.method': 'method', 'def.method.static': 'method',
  'def.class': 'class', 'def.class.object': 'class', 'def.class.template': 'class',
  'def.impl': 'class', 'def.interface': 'interface', 'def.enum': 'enum',
  'def.struct': 'struct', 'def.trait': 'trait', 'def.type_alias': 'type_alias',
  'def.constant': 'constant', 'def.namespace': 'namespace', 'def.module': 'module',
  'def.property': 'property', 'def.var': 'variable', 'def.constructor': 'constructor',
};

function captureKind(name: string): NodeKind | null {
  if (CAPTURE_KIND[name]) return CAPTURE_KIND[name];
  const base = name.replace(/\.name$/, '');
  return CAPTURE_KIND[base] ?? null;
}

function isDefCapture(name: string): boolean {
  return name.startsWith('def.');
}

// ─── Tree-sitter extraction (minimal, no metadata for speed) ─────────────────

async function extractTreeSitter(
  lang: Language,
  source: string,
  relativePath: string,
  fileNodeId: string,
  queryStr: string,
): Promise<{ nodes: CodeNode[]; edges: CodeEdge[] } | null> {
  const tsLang = await getLanguage(lang);
  if (!tsLang) return null;
  const tree = await parseSource(lang, source);
  if (!tree) return null;

  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const seen = new Set<string>();

  // Hoist line-split so we don't re-split source on every match iteration.
  const sourceLines = source.split('\n');

  const matches = runQueryMatches(tree as unknown as import('web-tree-sitter').Tree, tsLang, queryStr);

  for (const match of matches) {
    const defCapture = match.captures.find((c) => isDefCapture(c.name) && !c.name.endsWith('.name'));
    const nameCapture = match.captures.find((c) => c.name.endsWith('.name'));
    if (!defCapture || !nameCapture) continue;

    const kind = captureKind(defCapture.name);
    if (!kind) continue;

    const name = nameCapture.text.trim();
    if (!name) continue;

    const dedupeKey = `${kind}:${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const defNode = defCapture.node as unknown as TSNode;
    const startLine = defNode.startPosition.row + 1;
    const endLine = defNode.endPosition.row + 1;
    if (startLine > endLine) continue;

    const nodeId = generateNodeId(kind, relativePath, name);
    nodes.push({
      id: nodeId, kind, name, filePath: relativePath,
      startLine, endLine,
      content: sourceLines.slice(startLine - 1, Math.min(startLine + 19, endLine)).join('\n'),
    });
    edges.push({
      id: generateEdgeId(fileNodeId, nodeId, 'contains'),
      source: fileNodeId, target: nodeId, kind: 'contains', weight: 1.0,
    });
  }

  return { nodes, edges };
}

// ─── Regex fallback (lightweight, no metadata) ────────────────────────────────

function extractRegex(
  source: string,
  lang: Language,
  relativePath: string,
  fileNodeId: string,
): { nodes: CodeNode[]; edges: CodeEdge[] } {
  // Delegate to the same logic used in the main thread
  // (import at top is not allowed in worker without full bundling — inline minimal version)
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  return { nodes, edges }; // minimal; main thread regex fallback handles this case
}

// ─── Message handler ──────────────────────────────────────────────────────────

if (!parentPort) {
  throw new Error('parse-worker must be run as a Worker thread');
}

parentPort.on('message', async (task: ParseTask) => {
  try {
    const lang = task.lang as Language;
    let result: { nodes: CodeNode[]; edges: CodeEdge[] } | null = null;
    let usedTreeSitter = false;

    if (task.queryStr) {
      try {
        result = await extractTreeSitter(lang, task.source, task.relativePath, task.fileNodeId, task.queryStr);
        if (result && result.nodes.length > 0) usedTreeSitter = true;
        else result = null;
      } catch (err) {
        Logger.warn(`[parse-worker] tree-sitter failed for ${task.relativePath}: ${err}`);
        result = null;
      }
    }

    if (!result) {
      result = extractRegex(task.source, lang, task.relativePath, task.fileNodeId);
    }

    const res: ParseResult = {
      taskId: task.taskId,
      nodes: result.nodes,
      edges: result.edges,
      usedTreeSitter,
    };
    parentPort!.postMessage(res);
  } catch (err) {
    const res: ParseResult = {
      taskId: task.taskId,
      nodes: [], edges: [],
      usedTreeSitter: false,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort!.postMessage(res);
  }
});
