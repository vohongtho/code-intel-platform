/**
 * Exact-span rename adapter for TypeScript/JavaScript ES modules.
 *
 * Finds every occurrence of a module-scope binding across the indexed files and
 * classifies each one. An occurrence is `exact-*` only when lexical scoping
 * (block, function, catch, type-parameter and pattern bindings) and ES-module
 * resolution (named imports, aliases, re-exports, `export *` barrels and
 * namespace imports) prove it refers to the target binding. Everything the
 * adapter cannot prove becomes `candidate-text` (never edited) or
 * `unsupported` (blocks apply), so a plan can be partial but never wrong.
 *
 * Offsets are UTF-16 indices into the file text (tree-sitter's string mode);
 * every exact span is checked against the source text before it is emitted.
 */
import path from 'node:path';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { Language } from '../shared/languages.js';
import { parseSource } from '../parsing/parser-manager.js';
import type { OccurrenceRole, RenameBoundary, RenameOccurrence } from './contracts.js';

export interface ExactSpanContext {
  /** Repo-relative POSIX paths of TS/JS files known to the index. */
  files: ReadonlySet<string>;
  readFile(filePath: string): string;
  /** True when tsconfig `paths`/`baseUrl` could map a bare specifier onto a workspace file. */
  hasPathAliases: boolean;
}

export interface ExactSpanTarget {
  filePath: string;
  name: string;
  /** 1-based line of the graph node; matched against the declaration or its name. */
  line?: number;
}

export interface ExactSpanResult {
  /** A module-scope declaration matching the target was found. */
  moduleScope: boolean;
  occurrences: RenameOccurrence[];
  boundaries: RenameBoundary[];
  /** Files that would receive exact edits. */
  editedFiles: string[];
  scannedFiles: number;
}

const JS_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];
const GENERATED_PATH = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|generated|__generated__)\/|\.(generated|gen|min)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

const FUNCTION_SCOPES = new Set([
  'function_declaration', 'generator_function_declaration', 'function_expression', 'function', 'generator_function',
  'arrow_function', 'method_definition', 'function_signature', 'method_signature', 'construct_signature', 'call_signature',
]);
const BLOCK_SCOPES = new Set(['program', 'statement_block', 'for_statement', 'for_in_statement', 'catch_clause', 'switch_body', 'class_body']);
const NAMED_DECLARATIONS = new Set([
  'function_declaration', 'generator_function_declaration', 'class_declaration', 'abstract_class_declaration',
  'interface_declaration', 'type_alias_declaration', 'enum_declaration', 'internal_module', 'module', 'function_signature',
]);

export function languageForPath(filePath: string): Language | null {
  const ext = path.posix.extname(filePath);
  if (['.ts', '.mts', '.cts', '.tsx'].includes(ext)) return Language.TypeScript;
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) return Language.JavaScript;
  return null;
}

export function isGeneratedPath(filePath: string): boolean {
  return GENERATED_PATH.test(filePath);
}

function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function position(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Identifiers bound by a declaration pattern (`a`, `{ a, b: c }`, `[d, ...e]`, `f = 1`). */
function patternNames(node: SyntaxNode | null, out: SyntaxNode[] = []): SyntaxNode[] {
  if (!node) return out;
  switch (node.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      out.push(node);
      break;
    case 'pair_pattern':
      patternNames(node.childForFieldName('value'), out);
      break;
    case 'assignment_pattern':
    case 'object_assignment_pattern':
      patternNames(node.childForFieldName('left'), out);
      break;
    case 'required_parameter':
    case 'optional_parameter':
      patternNames(node.childForFieldName('pattern'), out);
      break;
    default:
      if (['object_pattern', 'array_pattern', 'rest_pattern', 'formal_parameters'].includes(node.type)) {
        for (const child of node.namedChildren) if (child) patternNames(child, out);
      }
  }
  return out;
}

/** web-tree-sitter returns a fresh wrapper per access; compare nodes by id, never by reference. */
function sameNode(a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined): boolean {
  return Boolean(a && b && a.id === b.id);
}

function nearest(node: SyntaxNode, types: ReadonlySet<string>): SyntaxNode | null {
  for (let current = node.parent; current; current = current.parent) if (types.has(current.type)) return current;
  return null;
}

const ALL_SCOPES = new Set([...FUNCTION_SCOPES, ...BLOCK_SCOPES]);
const VAR_SCOPES = new Set([...FUNCTION_SCOPES, 'program']);

interface ScopeModel {
  /** scope node id → names declared directly in it */
  declarations: Map<number, Set<string>>;
  /** ids of identifier nodes that are binding sites (not references) */
  bindingSites: Set<number>;
}

function addDecl(model: ScopeModel, scope: SyntaxNode | null, names: SyntaxNode[]): void {
  if (!scope) return;
  let set = model.declarations.get(scope.id);
  if (!set) model.declarations.set(scope.id, (set = new Set()));
  for (const name of names) {
    set.add(name.text);
    model.bindingSites.add(name.id);
  }
}

function buildScopes(root: SyntaxNode): ScopeModel {
  const model: ScopeModel = { declarations: new Map(), bindingSites: new Set() };
  const visit = (node: SyntaxNode) => {
    switch (node.type) {
      case 'variable_declarator': {
        const isVar = node.parent?.type === 'variable_declaration';
        addDecl(model, nearest(node, isVar ? VAR_SCOPES : BLOCK_SCOPES), patternNames(node.childForFieldName('name')));
        break;
      }
      case 'formal_parameters':
        addDecl(model, node.parent, patternNames(node));
        break;
      case 'arrow_function': {
        const param = node.childForFieldName('parameter');
        if (param) addDecl(model, node, patternNames(param));
        break;
      }
      case 'catch_clause':
        addDecl(model, node, patternNames(node.childForFieldName('parameter')));
        break;
      case 'for_in_statement':
        addDecl(model, node, patternNames(node.childForFieldName('left')));
        break;
      case 'type_parameter': {
        const owner = node.parent?.parent ?? null;
        const name = node.childForFieldName('name');
        if (name) addDecl(model, owner, [name]);
        break;
      }
      case 'infer_type': {
        const name = node.namedChildren.find((child) => child?.type === 'type_identifier');
        if (name) addDecl(model, nearest(node, new Set(['conditional_type'])), [name]);
        break;
      }
      case 'import_specifier': {
        const local = node.childForFieldName('alias') ?? node.childForFieldName('name');
        if (local) addDecl(model, root, [local]);
        break;
      }
      case 'namespace_import':
      case 'import_clause':
        for (const child of node.namedChildren) if (child?.type === 'identifier') addDecl(model, root, [child]);
        break;
      case 'function_expression':
      case 'generator_function':
      case 'function':
      case 'class': {
        const name = node.childForFieldName('name');
        if (name) addDecl(model, node, [name]);
        break;
      }
      default:
        if (NAMED_DECLARATIONS.has(node.type)) {
          const name = node.childForFieldName('name');
          if (name && (name.type === 'identifier' || name.type === 'type_identifier')) {
            // A declaration binds in the scope that contains it, not in itself.
            addDecl(model, nearest(node, BLOCK_SCOPES), [name]);
          }
        }
    }
    for (const child of node.namedChildren) if (child) visit(child);
  };
  visit(root);
  return model;
}

function resolvingScope(node: SyntaxNode, name: string, model: ScopeModel): SyntaxNode | null {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (ALL_SCOPES.has(current.type) || current.type === 'type_alias_declaration' || current.type === 'interface_declaration'
      || current.type === 'class_declaration' || current.type === 'conditional_type' || current.type === 'function_expression') {
      if (model.declarations.get(current.id)?.has(name)) return current;
    }
    if (current.type === 'program') return null;
  }
  return null;
}

function stringLiteral(node: SyntaxNode | null): string | null {
  if (!node || node.type !== 'string') return null;
  const fragment = node.namedChildren.find((child) => child?.type === 'string_fragment');
  return fragment ? fragment.text : '';
}

type ModuleResolution = { kind: 'file'; filePath: string } | { kind: 'external' } | { kind: 'unresolved' };

function resolveModule(fromFile: string, specifier: string, ctx: ExactSpanContext): ModuleResolution {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return ctx.hasPathAliases ? { kind: 'unresolved' } : { kind: 'external' };
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const stems = [base];
  const ext = path.posix.extname(base);
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) stems.push(base.slice(0, -ext.length));
  const candidates = [
    ...stems.flatMap((stem) => [stem, ...JS_EXTENSIONS.map((e) => `${stem}${e}`)]),
    ...JS_EXTENSIONS.map((e) => `${base}/index${e}`),
  ];
  const found = candidates.find((candidate) => ctx.files.has(candidate));
  return found ? { kind: 'file', filePath: found } : { kind: 'unresolved' };
}

interface ParsedFile {
  filePath: string;
  text: string;
  root: SyntaxNode;
  hasError: boolean;
  scopes: ScopeModel;
  starts: number[];
}

/** Exposure of the target binding by a module under an export name; `renamed` when that name follows the rename. */
type Exposures = Map<string, Map<string, boolean>>;

function exposes(exposures: Exposures, filePath: string, exportName: string): boolean | undefined {
  return exposures.get(filePath)?.get(exportName);
}

function setExposure(exposures: Exposures, filePath: string, exportName: string, renamed: boolean): boolean {
  let map = exposures.get(filePath);
  if (!map) exposures.set(filePath, (map = new Map()));
  if (map.get(exportName) === renamed) return false;
  map.set(exportName, renamed);
  return true;
}

function moduleScopeDeclarations(root: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (const top of root.namedChildren) {
    if (!top) continue;
    const decl = top.type === 'export_statement' ? (top.childForFieldName('declaration') ?? top.namedChildren.find((c) => c && NAMED_DECLARATIONS.has(c.type)) ?? null) : top;
    if (!decl) continue;
    if (NAMED_DECLARATIONS.has(decl.type)) {
      const nameNode = decl.childForFieldName('name');
      if (nameNode?.text === name) out.push(nameNode);
    } else if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
      for (const declarator of decl.namedChildren) {
        if (declarator?.type !== 'variable_declarator') continue;
        for (const id of patternNames(declarator.childForFieldName('name'))) if (id.text === name) out.push(id);
      }
    }
  }
  return out;
}

/**
 * Collect and classify every occurrence of the target binding. Pure with
 * respect to the filesystem except through `ctx.readFile`.
 */
export async function collectExactRenameOccurrences(
  target: ExactSpanTarget,
  newName: string,
  ctx: ExactSpanContext,
  options: { maxFiles?: number } = {},
): Promise<ExactSpanResult> {
  const name = target.name;
  const occurrences: RenameOccurrence[] = [];
  const boundaries: RenameBoundary[] = [];
  const wordPattern = new RegExp(`(?<![\\w$])${escapeRegex(name)}(?![\\w$])`, 'g');
  const parsed = new Map<string, ParsedFile>();
  const maxFiles = options.maxFiles ?? 20_000;

  const parse = async (filePath: string): Promise<ParsedFile | null> => {
    if (parsed.has(filePath)) return parsed.get(filePath)!;
    const language = languageForPath(filePath);
    if (!language) return null;
    const text = ctx.readFile(filePath);
    const tree = await parseSource(language, text);
    if (!tree) return null;
    const file: ParsedFile = { filePath, text, root: tree.rootNode, hasError: tree.rootNode.hasError, scopes: buildScopes(tree.rootNode), starts: lineIndex(text) };
    parsed.set(filePath, file);
    return file;
  };

  const occurrence = (file: ParsedFile, node: { startIndex: number; endIndex: number }, category: RenameOccurrence['category'], role: OccurrenceRole, reason?: string) => {
    const start = position(file.starts, node.startIndex);
    const end = position(file.starts, node.endIndex);
    const exact = category === 'exact-definition' || category === 'exact-semantic';
    occurrences.push({
      category: exact && isGeneratedPath(file.filePath) ? 'generated' : category,
      role,
      filePath: file.filePath,
      range: { startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column },
      ...(exact ? { startOffset: node.startIndex, endOffset: node.endIndex } : {}),
      text: file.text.slice(node.startIndex, node.endIndex),
      ...(reason ? { reason } : {}),
    });
  };

  // ── 1. Defining module ────────────────────────────────────────────────────
  const defining = await parse(target.filePath);
  if (!defining) {
    return { moduleScope: false, occurrences, boundaries: [{ kind: 'unsupported-language', message: `${target.filePath} is not a TypeScript/JavaScript module`, filePath: target.filePath }], editedFiles: [], scannedFiles: 0 };
  }
  const declarations = moduleScopeDeclarations(defining.root, name);
  const atLine = declarations.filter((decl) => {
    const declLine = position(defining.starts, decl.startIndex).line;
    let owner: SyntaxNode | null = decl.parent;
    while (owner && owner.parent && owner.parent.type !== 'program') owner = owner.parent;
    const ownerLine = owner ? position(defining.starts, owner.startIndex).line : declLine;
    return target.line === undefined || target.line === declLine || target.line === ownerLine;
  });
  if (atLine.length === 0) {
    return {
      moduleScope: false,
      occurrences,
      boundaries: [{ kind: 'non-module-scope', message: `${name} at ${target.filePath}:${target.line ?? '?'} is not a module-scope declaration; members and locals are preview-only`, filePath: target.filePath }],
      editedFiles: [],
      scannedFiles: 1,
    };
  }
  if (declarations.length > 1) {
    boundaries.push({ kind: 'merged-declaration', message: `${name} has ${declarations.length} module-scope declarations (overloads or declaration merging); renaming one would split the binding`, filePath: target.filePath });
  }
  if (defining.hasError) boundaries.push({ kind: 'parse-error', message: `${target.filePath} has syntax the parser could not read; spans in it are not provably exact`, filePath: target.filePath });

  const declarationIds = new Set(declarations.map((decl) => decl.id));
  const exposures: Exposures = new Map();
  const exported = declarations.some((decl) => {
    for (let n: SyntaxNode | null = decl.parent; n; n = n.parent) if (n.type === 'export_statement') return true;
    return false;
  });
  if (exported) setExposure(exposures, target.filePath, name, true);

  // ── 2. Candidate files and re-export fixed point ─────────────────────────
  const candidates = [...ctx.files].filter((filePath) => languageForPath(filePath)).sort();
  if (candidates.length > maxFiles) {
    boundaries.push({ kind: 'scan-limit', message: `workspace has ${candidates.length} TS/JS files; only the first ${maxFiles} were scanned` });
  }
  const relevant: string[] = [];
  const definingStem = path.posix.basename(target.filePath).replace(/\.[^.]+$/, '');
  for (const filePath of candidates.slice(0, maxFiles)) {
    const text = filePath === target.filePath ? defining.text : ctx.readFile(filePath);
    const dynamicLoad = text.includes(definingStem) && /\b(require|import)\s*\(/.test(text);
    if (filePath === target.filePath || text.includes(name) || /export\s*\*/.test(text) || dynamicLoad) relevant.push(filePath);
  }
  for (const filePath of relevant) await parse(filePath);

  // Local `export { X }` / `export { X as Y }` in the defining module.
  for (const spec of defining.root.descendantsOfType('export_specifier')) {
    if (!spec || spec.parent?.parent?.childForFieldName('source')) continue;
    const local = spec.childForFieldName('name');
    if (local?.text !== name || !sameNode(resolvingScope(local, name, defining.scopes), defining.root)) continue;
    const alias = spec.childForFieldName('alias');
    setExposure(exposures, target.filePath, alias?.text ?? name, !alias);
  }

  let changed = true;
  for (let round = 0; changed && round < relevant.length + 1; round++) {
    changed = false;
    for (const filePath of relevant) {
      const file = parsed.get(filePath);
      if (!file) continue;
      // `import { X } from './m'; export { X }` — a local re-export of an imported binding.
      const importedLocals = new Map<string, { module: string; importedName: string; aliased: boolean }>();
      for (const statement of file.root.namedChildren) {
        if (statement?.type !== 'import_statement') continue;
        const source = stringLiteral(statement.childForFieldName('source'));
        const resolved = source === null ? null : resolveModule(filePath, source, ctx);
        if (resolved?.kind !== 'file') continue;
        for (const spec of statement.descendantsOfType('import_specifier')) {
          const imported = spec?.childForFieldName('name');
          if (!imported) continue;
          const alias = spec!.childForFieldName('alias');
          importedLocals.set(alias?.text ?? imported.text, { module: resolved.filePath, importedName: imported.text, aliased: Boolean(alias) });
        }
      }
      for (const statement of file.root.namedChildren) {
        if (statement?.type !== 'export_statement' || statement.childForFieldName('source')) continue;
        for (const spec of statement.descendantsOfType('export_specifier')) {
          const local = spec?.childForFieldName('name');
          const binding = local ? importedLocals.get(local.text) : undefined;
          if (!local || !binding || !sameNode(resolvingScope(local, local.text, file.scopes), file.root)) continue;
          const renamed = exposes(exposures, binding.module, binding.importedName);
          if (renamed === undefined) continue;
          const alias = spec!.childForFieldName('alias');
          changed = setExposure(exposures, filePath, alias?.text ?? local.text, renamed && !binding.aliased && !alias) || changed;
        }
      }
      for (const statement of file.root.namedChildren) {
        if (statement?.type !== 'export_statement') continue;
        const source = stringLiteral(statement.childForFieldName('source'));
        if (source === null) continue;
        const resolved = resolveModule(filePath, source, ctx);
        if (resolved.kind !== 'file') continue;
        const clause = statement.namedChildren.find((child) => child?.type === 'export_clause');
        if (!clause) {
          // `export * from` (a namespace export `export * as ns` has an identifier child and is handled below).
          if (statement.namedChildren.some((child) => child?.type === 'namespace_export')) continue;
          const upstream = exposures.get(resolved.filePath);
          if (!upstream) continue;
          for (const [exportName, renamed] of upstream) {
            if (moduleScopeDeclarations(file.root, exportName).length > 0) continue; // local declaration shadows star export
            changed = setExposure(exposures, filePath, exportName, renamed) || changed;
          }
          continue;
        }
        for (const spec of clause.namedChildren) {
          if (spec?.type !== 'export_specifier') continue;
          const imported = spec.childForFieldName('name');
          if (!imported) continue;
          const renamed = exposes(exposures, resolved.filePath, imported.text);
          if (renamed === undefined) continue;
          const alias = spec.childForFieldName('alias');
          changed = setExposure(exposures, filePath, alias?.text ?? imported.text, renamed && !alias) || changed;
        }
      }
    }
  }

  // ── 3. Classify occurrences per file ──────────────────────────────────────
  const editedFiles = new Set<string>();
  for (const filePath of relevant) {
    const file = parsed.get(filePath);
    if (!file) continue;
    const isDefining = filePath === target.filePath;
    const startCount = occurrences.length;
    const handled = new Set<number>();
    const namespaceBindings = new Set<string>();
    let fileBindsTarget = isDefining;

    for (const statement of file.root.namedChildren) {
      if (!statement) continue;
      if (statement.type === 'import_statement') {
        const source = stringLiteral(statement.childForFieldName('source'));
        if (source === null) continue;
        const resolved = resolveModule(filePath, source, ctx);
        const clause = statement.namedChildren.find((child) => child?.type === 'import_clause');
        if (!clause) continue;
        for (const spec of clause.descendantsOfType('import_specifier')) {
          if (!spec) continue;
          const imported = spec.childForFieldName('name');
          if (imported?.text !== name) continue;
          handled.add(imported.id);
          if (resolved.kind === 'external') continue;
          if (resolved.kind === 'unresolved') {
            occurrence(file, imported, 'unsupported', 'import-specifier', `cannot resolve module '${source}'`);
            continue;
          }
          const renamed = exposes(exposures, resolved.filePath, name);
          if (renamed === undefined) continue;
          if (renamed) occurrence(file, imported, 'exact-semantic', 'import-specifier');
          if (!spec.childForFieldName('alias') && renamed) fileBindsTarget = true;
        }
        const namespace = clause.namedChildren.find((child) => child?.type === 'namespace_import');
        const nsName = namespace?.namedChildren.find((child) => child?.type === 'identifier');
        if (nsName && resolved.kind === 'file' && exposes(exposures, resolved.filePath, name)) namespaceBindings.add(nsName.text);
      } else if (statement.type === 'export_statement') {
        const source = stringLiteral(statement.childForFieldName('source'));
        if (source === null) continue;
        const resolved = resolveModule(filePath, source, ctx);
        if (resolved.kind !== 'file' || !exposures.has(resolved.filePath)) continue;
        if (statement.namedChildren.some((child) => child?.type === 'namespace_export') && exposes(exposures, resolved.filePath, name) !== undefined) {
          occurrence(file, statement, 'unsupported', 'export-specifier', 'namespace re-export (`export * as ns`) uses are not tracked');
        }
        for (const spec of statement.descendantsOfType('export_specifier')) {
          const imported = spec?.childForFieldName('name');
          if (!imported || imported.text !== name) continue;
          handled.add(imported.id);
          if (exposes(exposures, resolved.filePath, name)) occurrence(file, imported, 'exact-semantic', 'export-specifier');
        }
      }
    }

    // CommonJS / dynamic loads of an exposing module: member uses cannot be proven.
    for (const call of file.root.descendantsOfType('call_expression')) {
      if (!call) continue;
      const fn = call.childForFieldName('function');
      if (!fn || (fn.text !== 'require' && fn.type !== 'import')) continue;
      const arg = call.childForFieldName('arguments')?.namedChildren[0] ?? null;
      const spec = stringLiteral(arg);
      if (spec === null) continue;
      const resolved = resolveModule(filePath, spec, ctx);
      if (resolved.kind === 'file' && exposes(exposures, resolved.filePath, name) !== undefined) {
        occurrence(file, call, 'unsupported', 'other', 'CommonJS/dynamic import of the defining module; member uses are not tracked');
      }
    }

    const targetScope = fileBindsTarget ? file.root : null;
    for (const node of file.root.descendantsOfType(['identifier', 'type_identifier', 'property_identifier', 'shorthand_property_identifier'])) {
      if (!node || node.text !== name || handled.has(node.id)) continue;
      const parent = node.parent;
      if (parent?.type === 'import_specifier' || (parent?.type === 'export_specifier' && parent.childForFieldName('alias')?.id === node.id)) continue;
      if (parent?.type === 'import_clause' || parent?.type === 'namespace_import') continue;

      const namespaceObject = parent?.type === 'member_expression' && parent.childForFieldName('property')?.id === node.id
        ? parent.childForFieldName('object')
        : parent?.type === 'nested_type_identifier' && parent.childForFieldName('name')?.id === node.id
          ? parent.childForFieldName('module')
          : null;
      if (namespaceObject || node.type === 'property_identifier') {
        const bound = namespaceObject?.type === 'identifier' && namespaceBindings.has(namespaceObject.text)
          && sameNode(resolvingScope(namespaceObject, namespaceObject.text, file.scopes), file.root);
        if (bound) occurrence(file, node, 'exact-semantic', 'namespace-member');
        else occurrence(file, node, 'candidate-text', 'property', 'property or member name; not provably the target binding');
        continue;
      }

      const scope = resolvingScope(node, name, file.scopes);
      if (!targetScope || !sameNode(scope, targetScope)) continue; // a different binding of the same name
      if (isDefining && declarationIds.has(node.id)) {
        occurrence(file, node, 'exact-definition', 'definition');
      } else if (node.type === 'shorthand_property_identifier') {
        occurrence(file, node, 'unsupported', 'property', 'shorthand property: renaming would change the object key');
      } else if (file.scopes.bindingSites.has(node.id)) {
        // Another module-scope binding site of the same name (e.g. an overload); reported via merged-declaration.
        occurrence(file, node, 'exact-definition', 'definition');
      } else {
        occurrence(file, node, 'exact-semantic', parent?.type === 'export_specifier' ? 'export-specifier' : 'reference');
      }
    }

    for (const node of file.root.descendantsOfType(['string_fragment', 'comment'])) {
      if (!node) continue;
      for (const match of node.text.matchAll(wordPattern)) {
        const start = node.startIndex + match.index!;
        occurrence(file, { startIndex: start, endIndex: start + name.length }, 'candidate-text', node.type === 'comment' ? 'comment' : 'string', 'text mention; not edited');
      }
    }

    const fileOccurrences = occurrences.slice(startCount);
    const exactHere = fileOccurrences.filter((o) => o.category === 'exact-definition' || o.category === 'exact-semantic');
    if (exactHere.length > 0) {
      editedFiles.add(filePath);
      if (file.hasError) {
        boundaries.push({ kind: 'parse-error', message: `${filePath} has syntax the parser could not read; spans in it are not provably exact`, filePath });
      }
      // Conservative: any existing use of the new name (declared, imported or a free global) collides.
      const collides = file.root.descendantsOfType(['identifier', 'type_identifier', 'shorthand_property_identifier']).some((n) => n?.text === newName);
      if (collides) boundaries.push({ kind: 'name-collision', message: `${newName} is already declared in ${filePath}`, filePath });
    }
    if (fileOccurrences.some((o) => o.category === 'generated')) {
      boundaries.push({ kind: 'generated-file', message: `${filePath} looks generated or vendored; it is never edited automatically`, filePath });
    }
    if (fileOccurrences.some((o) => o.category === 'unsupported')) {
      boundaries.push({ kind: 'unsupported-occurrence', message: `${filePath} uses ${name} in a form the adapter cannot rewrite exactly`, filePath });
    }
  }

  // A barrel that already exports the new name would collide after the rename.
  for (const [filePath, names] of exposures) {
    if (names.get(name) && moduleScopeDeclarations(parsed.get(filePath)?.root ?? defining.root, newName).length > 0) {
      boundaries.push({ kind: 'name-collision', message: `${filePath} already exports ${newName}`, filePath });
    }
  }

  for (const o of occurrences) {
    if (o.startOffset === undefined) continue;
    const text = parsed.get(o.filePath)?.text ?? '';
    if (text.slice(o.startOffset, o.endOffset) !== name) {
      o.category = 'unsupported';
      o.reason = 'span does not match the source text';
      boundaries.push({ kind: 'unsupported-occurrence', message: `span mismatch in ${o.filePath}:${o.range.startLine}`, filePath: o.filePath });
    }
  }

  occurrences.sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.range.startLine - b.range.startLine) || (a.range.startColumn - b.range.startColumn) || a.category.localeCompare(b.category));
  return { moduleScope: true, occurrences, boundaries: dedupeBoundaries(boundaries), editedFiles: [...editedFiles].sort(), scannedFiles: relevant.length };
}

function dedupeBoundaries(boundaries: RenameBoundary[]): RenameBoundary[] {
  const seen = new Set<string>();
  return boundaries.filter((b) => {
    const key = `${b.kind}|${b.filePath ?? ''}|${b.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.kind.localeCompare(b.kind) || (a.filePath ?? '').localeCompare(b.filePath ?? '') || a.message.localeCompare(b.message));
}
