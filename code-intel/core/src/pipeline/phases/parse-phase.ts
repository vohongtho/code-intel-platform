import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage, Language } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';
import type { CodeNode, CodeEdge, NodeKind } from '../../shared/index.js';
import Logger from '../../shared/logger.js';
import { parseSource, getLanguage } from '../../parsing/parser-manager.js';
import { runQueryMatches } from '../../parsing/query-runner.js';
import type { Node as TSNode, Language as TSLanguage } from 'web-tree-sitter';
import {
  typescriptQueries,
  javascriptQueries,
  pythonQueries,
  javaQueries,
  goQueries,
  cQueries,
  cppQueries,
  csharpQueries,
  rustQueries,
  phpQueries,
  kotlinQueries,
  rubyQueries,
  swiftQueries,
} from '../../parsing/queries/index.js';

// ─── Query map ───────────────────────────────────────────────────────────────

const LANG_QUERIES: Partial<Record<Language, string>> = {
  [Language.TypeScript]: typescriptQueries,
  [Language.JavaScript]: javascriptQueries,
  [Language.Python]:     pythonQueries,
  [Language.Java]:       javaQueries,
  [Language.Go]:         goQueries,
  [Language.C]:          cQueries,
  [Language.Cpp]:        cppQueries,
  [Language.CSharp]:     csharpQueries,
  [Language.Rust]:       rustQueries,
  [Language.PHP]:        phpQueries,
  [Language.Kotlin]:     kotlinQueries,
  [Language.Ruby]:       rubyQueries,
  [Language.Swift]:      swiftQueries,
};

// ─── Capture-name → NodeKind map ─────────────────────────────────────────────

const CAPTURE_KIND: Record<string, NodeKind> = {
  'def.func':        'function',
  'def.func.decorated': 'function',
  'def.method':      'method',
  'def.method.static': 'method',
  'def.class':       'class',
  'def.class.object': 'class',
  'def.class.template': 'class',
  'def.impl':        'class',
  'def.interface':   'interface',
  'def.enum':        'enum',
  'def.struct':      'struct',
  'def.trait':       'trait',
  'def.type_alias':  'type_alias',
  'def.constant':    'constant',
  'def.namespace':   'namespace',
  'def.module':      'module',
  'def.property':    'property',
  'def.var':         'variable',
  'def.constructor': 'constructor',
};

// Captures that are NOT symbol definitions (skip them)
const NON_DEF_PREFIXES = ['imp.', 'call.', 'export', 'inherit.'];

function isDefCapture(name: string): boolean {
  if (!name.startsWith('def.')) return false;
  return true;
}

function captureKind(name: string): NodeKind | null {
  // Exact match first
  if (CAPTURE_KIND[name]) return CAPTURE_KIND[name];
  // Prefix match (e.g. "def.func.name" → strip ".name" → "def.func")
  const base = name.replace(/\.name$/, '');
  return CAPTURE_KIND[base] ?? null;
}

// ─── Exported-ness helpers ────────────────────────────────────────────────────

function isExported(node: TSNode, lang: Language, name?: string): boolean {
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    // Walk ancestor chain looking for export_statement
    let cur: TSNode | null = node.parent;
    while (cur) {
      if (cur.type === 'export_statement') return true;
      cur = cur.parent;
    }
    return false;
  }
  if (lang === Language.Java || lang === Language.CSharp) {
    // Check for 'public' modifier in enclosing modifiers or parent text
    let cur: TSNode | null = node.parent;
    while (cur) {
      if (cur.type === 'modifiers') return cur.text.includes('public');
      if (cur.type === 'class_declaration' || cur.type === 'method_declaration' ||
          cur.type === 'interface_declaration' || cur.type === 'enum_declaration') {
        return cur.text.trimStart().startsWith('public');
      }
      cur = cur.parent;
    }
    return false;
  }
  if (lang === Language.Go) {
    // Go: exported iff first letter is uppercase
    const n = name ?? node.text;
    return n.length > 0 && n[0] === n[0].toUpperCase() && /[A-Z]/.test(n[0]);
  }
  if (lang === Language.Rust) {
    // Walk ancestors for visibility_modifier (pub)
    let cur: TSNode | null = node.parent;
    while (cur) {
      if (cur.type === 'visibility_modifier') return true;
      // Stop at impl block boundary
      if (cur.type === 'source_file') break;
      cur = cur.parent;
    }
    return false;
  }
  if (lang === Language.Python) {
    // Python: exported iff name doesn't start with underscore
    const n = name ?? node.text;
    return !n.startsWith('_');
  }
  // Default: everything is exported (C, C++, PHP, Ruby, Swift, etc.)
  return true;
}

// ─── Parameter extraction ─────────────────────────────────────────────────────

interface Param { name: string; type?: string }

function extractParams(defNode: TSNode, lang: Language): Param[] {
  const params: Param[] = [];

  // TypeScript / JavaScript
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    const paramNode =
      defNode.childForFieldName?.('parameters') ??
      findFirstChildByType(defNode, 'formal_parameters') ??
      findFirstChildByType(defNode, 'formal_parameter');
    if (paramNode) {
      for (const child of paramNode.children) {
        if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
          const namePart = child.childForFieldName?.('pattern') ?? child.firstChild;
          const typePart = child.childForFieldName?.('type');
          if (namePart) {
            params.push({
              name: namePart.text,
              type: typePart ? typePart.text.replace(/^:\s*/, '') : undefined,
            });
          }
        } else if (child.type === 'identifier') {
          // Untyped JS parameter
          params.push({ name: child.text });
        }
      }
    }
    return params;
  }

  // Python
  if (lang === Language.Python) {
    const paramNode = defNode.childForFieldName?.('parameters');
    if (paramNode) {
      for (const child of paramNode.children) {
        if (child.type === 'identifier') {
          if (child.text === 'self' || child.text === 'cls') continue;
          params.push({ name: child.text });
        } else if (child.type === 'typed_parameter') {
          const name = child.children.find((c) => c.type === 'identifier');
          const type = child.children.find((c) => c.type === 'type');
          if (name) {
            params.push({ name: name.text, type: type?.text });
          }
        } else if (child.type === 'default_parameter') {
          const name = child.childForFieldName?.('name');
          if (name) params.push({ name: name.text });
        } else if (child.type === 'typed_default_parameter') {
          const name = child.childForFieldName?.('name');
          const type = child.childForFieldName?.('type');
          if (name) params.push({ name: name.text, type: type?.text });
        }
      }
    }
    return params;
  }

  // Go
  if (lang === Language.Go) {
    const paramNode = defNode.childForFieldName?.('parameters');
    if (paramNode) {
      for (const child of paramNode.children) {
        if (child.type === 'parameter_declaration') {
          const name = child.children.find((c) => c.type === 'identifier');
          const type = child.childForFieldName?.('type');
          if (name) params.push({ name: name.text, type: type?.text });
        }
      }
    }
    return params;
  }

  // Java / Kotlin / C# / PHP / Swift / Ruby — basic extraction
  const paramNode =
    defNode.childForFieldName?.('parameters') ??
    findFirstChildByType(defNode, 'formal_parameters') ??
    findFirstChildByType(defNode, 'function_value_parameters') ??
    findFirstChildByType(defNode, 'parameter_list');
  if (paramNode) {
    for (const child of paramNode.children) {
      if (child.type.includes('parameter')) {
        const name =
          child.childForFieldName?.('name') ??
          child.children.find((c) => c.type === 'identifier');
        if (name) params.push({ name: name.text });
      }
    }
  }
  return params;
}

// ─── Return type extraction ───────────────────────────────────────────────────

function extractReturnType(defNode: TSNode, lang: Language): string | undefined {
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    const retNode = defNode.childForFieldName?.('return_type');
    return retNode ? retNode.text.replace(/^:\s*/, '') : undefined;
  }
  if (lang === Language.Python) {
    const retNode = defNode.childForFieldName?.('return_type');
    return retNode ? retNode.text.replace(/^->\s*/, '') : undefined;
  }
  if (lang === Language.Go) {
    const retNode = defNode.childForFieldName?.('result');
    return retNode ? retNode.text : undefined;
  }
  if (lang === Language.Java || lang === Language.Kotlin) {
    const retNode = defNode.childForFieldName?.('type');
    return retNode ? retNode.text : undefined;
  }
  if (lang === Language.Rust) {
    const retNode = defNode.childForFieldName?.('return_type');
    return retNode ? retNode.text.replace(/^->\s*/, '') : undefined;
  }
  return undefined;
}

// ─── Doc / JSDoc extraction ───────────────────────────────────────────────────

function extractDoc(defNode: TSNode, source: string, lang: Language): string | undefined {
  const DOC_MAX = 500;

  /**
   * Find the "anchor" node whose previous sibling we look at for a doc comment.
   * For exported declarations (e.g. `export function foo ...`), the function_declaration
   * is inside `export_statement`, so we walk up to the export_statement first.
   */
  function anchorNode(n: TSNode): TSNode {
    let cur: TSNode = n;
    while (cur.parent && cur.parent.type === 'export_statement') {
      cur = cur.parent;
    }
    return cur;
  }

  const anchor = anchorNode(defNode);

  // Walk previous siblings of the anchor to find a comment, skipping decorators
  let prev: TSNode | null = anchor.previousSibling ?? prevSibling(anchor);
  while (prev && (prev.type === 'decorator' || prev.type.includes('attribute_item'))) {
    prev = prev.previousSibling ?? prevSibling(prev);
  }

  if (!prev) return undefined;

  // TypeScript/JavaScript: /** ... */
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    if (prev.type === 'comment' && prev.text.startsWith('/**')) {
      const lines = prev.text
        .split('\n')
        .map((l) => l.replace(/^\s*\*+\s?/, '').trim())
        .filter((l) => l !== '' && l !== '/' && l !== '*');
      const doc = lines.join('\n').slice(0, DOC_MAX);
      return doc || undefined;
    }
    return undefined;
  }

  // Java / C#: /** ... */
  if (lang === Language.Java || lang === Language.CSharp || lang === Language.Kotlin) {
    if (prev.type === 'block_comment' || prev.type === 'comment') {
      if (prev.text.startsWith('/**')) {
        const lines = prev.text
          .split('\n')
          .map((l) => l.replace(/^\s*\*+\s?/, '').trim())
          .filter(Boolean);
        return lines.join('\n').slice(0, DOC_MAX) || undefined;
      }
    }
    return undefined;
  }

  // Python: first string in body
  if (lang === Language.Python) {
    const body = defNode.childForFieldName?.('body');
    if (body) {
      const first = body.firstChild;
      if (first?.type === 'expression_statement') {
        const s = first.firstChild;
        if (s?.type === 'string') {
          return s.text.replace(/^["']{1,3}|["']{1,3}$/g, '').trim().slice(0, DOC_MAX);
        }
      }
    }
    return undefined;
  }

  // Go: preceding // comment lines
  if (lang === Language.Go) {
    const lines: string[] = [];
    let cur: TSNode | null = prev;
    while (cur && cur.type === 'comment') {
      lines.unshift(cur.text.replace(/^\/\/\s?/, '').trim());
      cur = cur.previousSibling ?? prevSibling(cur);
    }
    const doc = lines.join('\n').trim().slice(0, DOC_MAX);
    return doc || undefined;
  }

  // Rust: /// doc lines
  if (lang === Language.Rust) {
    const lines: string[] = [];
    let cur: TSNode | null = prev;
    while (cur && cur.type === 'line_comment') {
      const t = cur.text;
      if (t.startsWith('///')) {
        lines.unshift(t.replace(/^\/\/\/\s?/, '').trim());
      } else {
        break;
      }
      cur = cur.previousSibling ?? prevSibling(cur);
    }
    const doc = lines.join('\n').trim().slice(0, DOC_MAX);
    return doc || undefined;
  }

  return undefined;
}

// ─── Decorator / annotation extraction ────────────────────────────────────────

function extractDecorators(defNode: TSNode, lang: Language): string[] {
  const decs: string[] = [];

  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    // Decorators in TS can be:
    // 1. Children of export_statement (when exported: `@Dec() export class Foo {}`)
    // 2. Preceding siblings of the class/function node (non-exported)
    let anchor: TSNode = defNode;
    while (anchor.parent?.type === 'export_statement') anchor = anchor.parent;

    if (anchor.type === 'export_statement') {
      // Decorators are named children of export_statement
      for (const child of anchor.namedChildren) {
        if (child.type === 'decorator') decs.push(child.text);
      }
    } else {
      // Non-exported: decorators are preceding siblings
      let prev: TSNode | null = anchor.previousSibling;
      while (prev && prev.type === 'decorator') {
        decs.unshift(prev.text);
        prev = prev.previousSibling;
      }
    }
    return decs;
  }

  if (lang === Language.Java || lang === Language.Kotlin) {
    // Annotations live inside the modifiers child
    const modifiers = defNode.childForFieldName?.('modifiers');
    if (modifiers) {
      for (const child of modifiers.children) {
        if (child.type === 'marker_annotation' || child.type === 'annotation') {
          decs.push(child.text);
        }
      }
    }
    // Also preceding siblings for Kotlin
    let prev: TSNode | null = defNode.previousSibling ?? prevSibling(defNode);
    while (prev && (prev.type === 'marker_annotation' || prev.type === 'annotation')) {
      decs.unshift(prev.text);
      prev = prev.previousSibling ?? prevSibling(prev);
    }
    return decs;
  }

  if (lang === Language.Python) {
    // In Python AST, decorated_definition wraps decorator + definition
    const p = defNode.parent;
    if (p?.type === 'decorated_definition') {
      for (const child of p.children) {
        if (child.type === 'decorator') decs.push(child.text);
      }
    }
    return decs;
  }

  if (lang === Language.Rust) {
    // #[...] attribute_item nodes precede the function_item / struct_item etc.
    let prev: TSNode | null = defNode.previousSibling ?? prevSibling(defNode);
    while (prev && prev.type === 'attribute_item') {
      decs.unshift(prev.text);
      prev = prev.previousSibling ?? prevSibling(prev);
    }
    return decs;
  }

  return decs;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prevSibling(node: TSNode): TSNode | null {
  const parent = node.parent;
  if (!parent) return null;
  const children = parent.children;
  const idx = children.indexOf(node);
  if (idx <= 0) return null;
  return children[idx - 1] ?? null;
}

function findFirstChildByType(node: TSNode, type: string): TSNode | null {
  for (const child of node.children) {
    if (child.type === type) return child;
    const found = findFirstChildByType(child, type);
    if (found) return found;
  }
  return null;
}

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  return s.length <= max ? s : s.slice(0, max) + '…';
}

// ─── Tree-sitter parse phase ──────────────────────────────────────────────────

export const parsePhase: Phase = {
  name: 'parse',
  dependencies: ['structure'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    let symbolCount = 0;
    let treeSitterCount = 0;
    let regexCount = 0;

    // Initialise shared caches that resolve phase will reuse
    if (!context.fileCache) context.fileCache = new Map();
    if (!context.fileFunctionIndex) context.fileFunctionIndex = new Map();

    const CONCURRENCY = 64;
    const filePaths = context.filePaths;

    // ── Read all files ────────────────────────────────────────────────────────
    let readDone = 0;
    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const batch = filePaths.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (filePath) => {
        try {
          const source = await fs.promises.readFile(filePath, 'utf-8');
          context.fileCache!.set(filePath, source);
        } catch {
          // Unreadable file — skip silently
        }
      }));
      readDone += batch.length;
      context.onPhaseProgress?.('parse:read', readDone, filePaths.length);
    }

    // ── Parse each file ───────────────────────────────────────────────────────
    let parseDone = 0;
    for (const filePath of filePaths) {
      const lang = detectLanguage(filePath);
      if (!lang) {
        if (context.verbose) {
          const relativePath = path.relative(context.workspaceRoot, filePath);
          Logger.info(`  [parse] skipped (no parser): ${relativePath}`);
        }
        continue;
      }

      const source = context.fileCache.get(filePath);
      if (!source) continue;

      const relativePath = path.relative(context.workspaceRoot, filePath);
      const fileNodeId = generateNodeId('file', relativePath, relativePath);

      // Store a snippet on the file node for full-text search
      const fileNode = context.graph.getNode(fileNodeId);
      if (fileNode) {
        fileNode.content = source.slice(0, 2000);
      }

      // ── Try tree-sitter first ──────────────────────────────────────────────
      let usedTreeSitter = false;
      const queryStr = LANG_QUERIES[lang];

      if (queryStr) {
        try {
          const { nodes, edges } = await extractFromTreeAsync(
            lang,
            source,
            relativePath,
            fileNodeId,
            queryStr,
          );

          if (nodes.length > 0 || edges.length > 0) {
            for (const n of nodes) context.graph.addNode(n);
            for (const e of edges) context.graph.addEdge(e);
            symbolCount += nodes.length;
            treeSitterCount++;
            usedTreeSitter = true;

            // Build per-file sorted function/method index
            const funcs = nodes
              .filter((n) => n.kind === 'function' || n.kind === 'method')
              .map((n) => ({ id: n.id, startLine: n.startLine ?? 0, endLine: n.endLine }))
              .sort((a, b) => a.startLine - b.startLine);
            if (funcs.length > 0) {
              context.fileFunctionIndex!.set(relativePath, funcs);
            }
          }
        } catch (err) {
          Logger.warn(`  [parse] tree-sitter failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)} — falling back to regex`);
        }
      }

      // ── Fallback to regex if tree-sitter didn't run ───────────────────────
      if (!usedTreeSitter) {
        regexCount++;
        const { nodes, edges } = extractWithRegex(source, lang, relativePath, fileNodeId);
        for (const n of nodes) context.graph.addNode(n);
        for (const e of edges) context.graph.addEdge(e);
        symbolCount += nodes.length;

        const funcs = nodes
          .filter((n) => n.kind === 'function' || n.kind === 'method')
          .map((n) => ({ id: n.id, startLine: n.startLine ?? 0, endLine: n.endLine }))
          .sort((a, b) => a.startLine - b.startLine);
        if (funcs.length > 0) {
          context.fileFunctionIndex!.set(relativePath, funcs);
        }
      }

      parseDone++;
      context.onPhaseProgress?.('parse', parseDone, filePaths.length);
    }

    const parserUsed: 'tree-sitter' | 'regex' = treeSitterCount === 0 ? 'regex' : 'tree-sitter';
    // Store parser info in context for CLI/HTTP to write into meta.json
    context.parserUsed = parserUsed;

    if (context.verbose) {
      Logger.info(`  [parse] tree-sitter: ${treeSitterCount} files, regex fallback: ${regexCount} files`);
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Extracted ${symbolCount} symbols from ${filePaths.length} files (${parserUsed})`,
    };
  },
};

// ─── Tree-sitter extraction ───────────────────────────────────────────────────

async function extractFromTreeAsync(
  lang: Language,
  source: string,
  relativePath: string,
  fileNodeId: string,
  queryStr: string,
): Promise<{ nodes: CodeNode[]; edges: CodeEdge[] }> {
  const tsLang = await getLanguage(lang);
  if (!tsLang) return { nodes: [], edges: [] };

  const tree = await parseSource(lang, source);
  if (!tree) return { nodes: [], edges: [] };

  return extractFromTree(tree.rootNode as unknown as TSNode, tsLang, source, lang, relativePath, fileNodeId, queryStr);
}

function extractFromTree(
  root: TSNode,
  tsLanguage: TSLanguage,
  source: string,
  lang: Language,
  relativePath: string,
  fileNodeId: string,
  queryStr: string,
): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const seen = new Set<string>();

  // Hoist line-split so we don't re-split source on every match iteration.
  const sourceLines = source.split('\n');

  // Run the query to get all pattern matches
  const matches = runQueryMatches(
    { rootNode: root } as unknown as import('web-tree-sitter').Tree,
    tsLanguage,
    queryStr,
  );

  for (const match of matches) {
    // Find the "def.X" capture (the whole definition node)
    const defCapture = match.captures.find(
      (c) => isDefCapture(c.name) && !c.name.endsWith('.name'),
    );
    // Find the "def.X.name" capture (just the name identifier)
    const nameCapture = match.captures.find((c) => c.name.endsWith('.name'));

    if (!defCapture || !nameCapture) continue;

    const kind = captureKind(defCapture.name);
    if (!kind) continue;

    const name = nameCapture.text.trim();
    if (!name) continue;

    const dedupeKey = `${kind}:${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const defNode = defCapture.node;
    const startLine = defNode.startPosition.row + 1; // 1-based
    const endLine = defNode.endPosition.row + 1;

    // Validate
    if (startLine > endLine) {
      Logger.warn(`  [parse] ${relativePath}: ${name} startLine(${startLine}) > endLine(${endLine}), skipping`);
      continue;
    }

    // Extract rich metadata
    const params = (kind === 'function' || kind === 'method' || kind === 'constructor')
      ? extractParams(defNode, lang)
      : undefined;

    const returnType = (kind === 'function' || kind === 'method')
      ? extractReturnType(defNode, lang)
      : undefined;

    const doc = extractDoc(defNode, source, lang);
    const decorators = extractDecorators(defNode, lang);

    const metadata: Record<string, unknown> = {};
    if (params && params.length > 0) metadata.parameters = params;
    if (returnType) metadata.returnType = truncate(returnType, 200);
    if (doc) metadata.doc = doc;
    if (decorators.length > 0) metadata.decorators = decorators;

    const nodeId = generateNodeId(kind, relativePath, name);
    nodes.push({
      id: nodeId,
      kind,
      name,
      filePath: relativePath,
      startLine,
      endLine,
      exported: isExported(defNode, lang, name),
      content: sourceLines.slice(startLine - 1, Math.min(startLine + 19, endLine)).join('\n'),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    edges.push({
      id: generateEdgeId(fileNodeId, nodeId, 'contains'),
      source: fileNodeId,
      target: nodeId,
      kind: 'contains',
      weight: 1.0,
    });
  }

  return { nodes, edges };
}

// ─── Regex fallback (original logic, preserved for unsupported languages) ─────

function extractWithRegex(
  source: string,
  lang: Language,
  relativePath: string,
  fileNodeId: string,
): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const seen = new Set<string>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) continue;

    const extracted = extractSymbolRegex(trimmed, lang, i + 1, relativePath);
    if (!extracted) continue;

    const dedupeKey = extracted.name + ':' + extracted.kind;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const nodeId = generateNodeId(extracted.kind, relativePath, extracted.name);
    const endLine = estimateEndLine(lines, i, lang);

    nodes.push({
      id: nodeId,
      kind: extracted.kind,
      name: extracted.name,
      filePath: relativePath,
      startLine: i + 1,
      endLine,
      exported: extracted.exported,
      content: extractBlock(lines, i, 20),
    });
    edges.push({
      id: generateEdgeId(fileNodeId, nodeId, 'contains'),
      source: fileNodeId,
      target: nodeId,
      kind: 'contains',
      weight: 1.0,
    });

    if (extracted.ownerName) {
      const ownerId = generateNodeId('class', relativePath, extracted.ownerName);
      if (nodes.some((n) => n.id === ownerId)) {
        edges.push({
          id: generateEdgeId(ownerId, nodeId, 'has_member'),
          source: ownerId,
          target: nodeId,
          kind: 'has_member',
          weight: 1.0,
        });
      }
    }
  }

  return { nodes, edges };
}

// ─── Original regex symbol extraction (kept as fallback) ─────────────────────

interface ExtractedSymbol {
  kind: CodeNode['kind'];
  name: string;
  exported: boolean;
  ownerName?: string;
}

function extractSymbolRegex(
  line: string,
  lang: Language,
  _lineNum: number,
  _filePath: string,
): ExtractedSymbol | null {
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    const func = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: line.includes('export') };

    const arrowFunc = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (arrowFunc) return { kind: 'function', name: arrowFunc[1], exported: line.includes('export') };

    const arrowFunc2 = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/);
    if (arrowFunc2) return { kind: 'function', name: arrowFunc2[1], exported: line.includes('export') };

    const cls = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: line.includes('export') };

    const iface = line.match(/^(?:export\s+)?interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: line.includes('export') };

    const enumM = line.match(/^(?:export\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: line.includes('export') };

    const typeAlias = line.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/);
    if (typeAlias) return { kind: 'type_alias', name: typeAlias[1], exported: line.includes('export') };

    const constVar = line.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=/);
    if (constVar && /^[A-Z_]+$/.test(constVar[1])) {
      return { kind: 'constant', name: constVar[1], exported: line.includes('export') };
    }
  }

  if (lang === Language.Python) {
    const func = line.match(/^(?:async\s+)?def\s+(\w+)/);
    if (func) return { kind: func[1].startsWith('__') ? 'method' : 'function', name: func[1], exported: !func[1].startsWith('_') };
    const cls = line.match(/^class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !cls[1].startsWith('_') };
  }

  if (lang === Language.Java) {
    const cls = line.match(/(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: line.includes('public') };
    const iface = line.match(/(?:public\s+)?interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: line.includes('public') };
    const enumM = line.match(/(?:public\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: line.includes('public') };
    const method = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(/);
    if (method) return { kind: 'method', name: method[1], exported: line.includes('public') };
  }

  if (lang === Language.Go) {
    const func = line.match(/^func\s+(\w+)\s*\(/);
    if (func) return { kind: 'function', name: func[1], exported: func[1][0] === func[1][0].toUpperCase() };
    const method = line.match(/^func\s+\([^)]+\)\s+(\w+)\s*\(/);
    if (method) return { kind: 'method', name: method[1], exported: method[1][0] === method[1][0].toUpperCase() };
    const structM = line.match(/^type\s+(\w+)\s+struct\b/);
    if (structM) return { kind: 'struct', name: structM[1], exported: structM[1][0] === structM[1][0].toUpperCase() };
    const ifaceM = line.match(/^type\s+(\w+)\s+interface\b/);
    if (ifaceM) return { kind: 'interface', name: ifaceM[1], exported: ifaceM[1][0] === ifaceM[1][0].toUpperCase() };
  }

  if (lang === Language.Rust) {
    const func = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: line.startsWith('pub') };
    const structM = line.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (structM) return { kind: 'struct', name: structM[1], exported: line.startsWith('pub') };
    const enumM = line.match(/^(?:pub\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: line.startsWith('pub') };
    const traitM = line.match(/^(?:pub\s+)?trait\s+(\w+)/);
    if (traitM) return { kind: 'trait', name: traitM[1], exported: line.startsWith('pub') };
    const implM = line.match(/^impl(?:<[^>]*>)?\s+(\w+)/);
    if (implM) return { kind: 'class', name: implM[1], exported: false };
  }

  if (lang === Language.C || lang === Language.Cpp) {
    const cls = line.match(/^(?:class|struct)\s+(\w+)/);
    if (cls) return { kind: lang === Language.Cpp ? 'class' : 'struct', name: cls[1], exported: true };
    const nsM = line.match(/^namespace\s+(\w+)/);
    if (nsM) return { kind: 'namespace', name: nsM[1], exported: true };
    const func = line.match(/^(?:[\w:*&<>\[\]]+\s+)+(\w+)\s*\([^;]*$/);
    if (func && !['if', 'for', 'while', 'switch', 'return'].includes(func[1])) {
      return { kind: 'function', name: func[1], exported: true };
    }
  }

  if (lang === Language.CSharp) {
    const cls = line.match(/(?:public|internal|private)?\s*(?:static\s+)?(?:abstract\s+)?(?:partial\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: line.includes('public') };
    const iface = line.match(/(?:public\s+)?interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: line.includes('public') };
    const structM = line.match(/(?:public\s+)?struct\s+(\w+)/);
    if (structM) return { kind: 'struct', name: structM[1], exported: line.includes('public') };
    const method = line.match(/(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(/);
    if (method) return { kind: 'method', name: method[1], exported: line.includes('public') };
    const nsM = line.match(/namespace\s+([\w.]+)/);
    if (nsM) return { kind: 'namespace', name: nsM[1], exported: true };
  }

  if (lang === Language.PHP) {
    const cls = line.match(/(?:abstract\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: true };
    const func = line.match(/(?:public|private|protected|static\s+)*function\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: line.includes('public') || !line.includes('private') };
    const iface = line.match(/interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: true };
    const traitM = line.match(/trait\s+(\w+)/);
    if (traitM) return { kind: 'trait', name: traitM[1], exported: true };
  }

  if (lang === Language.Kotlin) {
    const cls = line.match(/(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !line.includes('private') };
    const iface = line.match(/interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: !line.includes('private') };
    const func = line.match(/(?:suspend\s+)?fun\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: !line.includes('private') };
    const obj = line.match(/object\s+(\w+)/);
    if (obj) return { kind: 'class', name: obj[1], exported: !line.includes('private') };
  }

  if (lang === Language.Ruby) {
    const cls = line.match(/^class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: true };
    const modM = line.match(/^module\s+(\w+)/);
    if (modM) return { kind: 'module', name: modM[1], exported: true };
    const method = line.match(/^(?:def\s+(?:self\.)?(\w+))/);
    if (method) return { kind: 'method', name: method[1], exported: true };
  }

  if (lang === Language.Swift) {
    const cls = line.match(/(?:public\s+|open\s+)?(?:final\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !line.includes('private') };
    const structM = line.match(/(?:public\s+)?struct\s+(\w+)/);
    if (structM) return { kind: 'struct', name: structM[1], exported: !line.includes('private') };
    const proto = line.match(/(?:public\s+)?protocol\s+(\w+)/);
    if (proto) return { kind: 'interface', name: proto[1], exported: !line.includes('private') };
    const enumM = line.match(/(?:public\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: !line.includes('private') };
    const func = line.match(/(?:public\s+|private\s+|internal\s+)?(?:static\s+)?func\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: !line.includes('private') };
  }

  if (lang === Language.Dart) {
    const cls = line.match(/(?:abstract\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !cls[1].startsWith('_') };
    const func = line.match(/^(?:\w+\s+)?(\w+)\s*\(/);
    if (func && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(func[1])) {
      return { kind: 'function', name: func[1], exported: !func[1].startsWith('_') };
    }
  }

  return null;
}

function estimateEndLine(lines: string[], startIdx: number, lang: Language): number | undefined {
  const MAX_SCAN = 200;
  const end = Math.min(startIdx + MAX_SCAN, lines.length);

  if (lang !== Language.Python && lang !== Language.Ruby) {
    let depth = 0;
    let foundOpen = false;
    for (let i = startIdx; i < end; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; foundOpen = true; }
        else if (ch === '}') {
          depth--;
          if (foundOpen && depth === 0) return i + 1;
        }
      }
    }
    return undefined;
  }

  const startIndent = (lines[startIdx].match(/^(\s*)/) ?? ['', ''])[1].length;
  for (let i = startIdx + 1; i < end; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    const indent = (l.match(/^(\s*)/) ?? ['', ''])[1].length;
    if (indent <= startIndent && l.trim() !== '') return i;
  }
  return undefined;
}

function extractBlock(lines: string[], startIdx: number, maxLines: number): string {
  const end = Math.min(startIdx + maxLines, lines.length);
  return lines.slice(startIdx, end).join('\n');
}
