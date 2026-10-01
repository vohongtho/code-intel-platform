/**
 * skeletonizer.ts — language-capability-gated structural rendering.
 *
 * A skeleton keeps the declaration, selected control headings, flow-spine
 * calls and return/throw statements of a function/method body, and replaces
 * every other statement with an explicit omission marker.
 *
 * Safety rules:
 *  - Rendering is driven by a tree-sitter parse, never by regex rewriting.
 *  - Statements are kept verbatim, collapsed to a heading plus nested kept
 *    statements, or omitted. Nothing is truncated mid-statement.
 *  - The emitted text is re-parsed; if it does not parse cleanly the result is
 *    `unsupported`, never best-effort corrupted text.
 *  - A language row is enabled only with fixture coverage in
 *    tests/unit/context/skeletonizer.test.ts.
 */

import { Language, detectLanguage } from '../shared/index.js';
import { parseSource } from '../parsing/index.js';
import type { Node, Tree } from 'web-tree-sitter';

export type SkeletonUnsupportedReason =
  | 'language-unsupported'
  | 'node-kind-unsupported'
  | 'grammar-unavailable'
  | 'parse-error'
  | 'no-function-found'
  | 'no-block-body'
  | 'trailing-content'
  | 'nothing-to-compress'
  | 'self-check-failed';

export interface SkeletonOk {
  status: 'ok';
  language: string;
  text: string;
  keptStatements: number;
  omittedStatements: number;
}

export interface SkeletonUnsupported {
  status: 'unsupported';
  reason: SkeletonUnsupportedReason;
  language?: string;
}

export type SkeletonResult = SkeletonOk | SkeletonUnsupported;

export interface SkeletonCapability {
  language: Language;
  /** True only when syntax-preservation fixtures pass for this row. */
  enabled: boolean;
  nodeKinds: readonly string[];
  preserves: readonly string[];
}

const BODY_NODE_KINDS = ['function', 'method', 'constructor'] as const;

export const SKELETON_CAPABILITIES: readonly SkeletonCapability[] = [
  { language: Language.TypeScript, enabled: true, nodeKinds: BODY_NODE_KINDS, preserves: ['declaration', 'if/for/while/try headings', 'call statements', 'return', 'throw'] },
  { language: Language.JavaScript, enabled: true, nodeKinds: BODY_NODE_KINDS, preserves: ['declaration', 'if/for/while/try headings', 'call statements', 'return', 'throw'] },
  { language: Language.Python, enabled: true, nodeKinds: BODY_NODE_KINDS, preserves: ['declaration', 'decorators', 'if/for/while/try/with headings', 'call statements', 'return', 'raise'] },
  { language: Language.Java, enabled: true, nodeKinds: BODY_NODE_KINDS, preserves: ['declaration', 'if/for/while/try headings', 'call statements', 'return', 'throw'] },
];

export function getSkeletonCapability(language: Language | string | null | undefined): SkeletonCapability | undefined {
  if (!language) return undefined;
  return SKELETON_CAPABILITIES.find((row) => row.language === language && row.enabled);
}

export interface SkeletonCapabilityRow {
  language: string;
  status: 'supported' | 'unsupported';
  nodeKinds: readonly string[];
  preserves: readonly string[];
  /** What Explore renders instead when this row cannot skeletonize. */
  fallback: 'none' | 'snippet-or-signature';
}

/** One row per known language: enabled rows come from SKELETON_CAPABILITIES, everything else safely falls back. */
export function getSkeletonCapabilityMatrix(): SkeletonCapabilityRow[] {
  return Object.values(Language).map((language) => {
    const row = getSkeletonCapability(language);
    return row
      ? { language, status: 'supported' as const, nodeKinds: row.nodeKinds, preserves: row.preserves, fallback: 'none' as const }
      : { language, status: 'unsupported' as const, nodeKinds: [], preserves: [], fallback: 'snippet-or-signature' as const };
  });
}

interface SyntaxProfile {
  comment: string;
  functionTypes: ReadonlySet<string>;
  blockTypes: ReadonlySet<string>;
  keep: ReadonlySet<string>;
  /** statement type → field holding the block that is recursed into */
  control: ReadonlyMap<string, string>;
  callWrapped: ReadonlySet<string>;
  wrapper: { before: string; after: string };
  indentBased: boolean;
  alwaysWrap: boolean;
}

const JS_PROFILE: SyntaxProfile = {
  comment: '//',
  functionTypes: new Set(['function_declaration', 'generator_function_declaration', 'method_definition', 'arrow_function', 'function_expression']),
  blockTypes: new Set(['statement_block']),
  keep: new Set(['return_statement', 'throw_statement']),
  control: new Map([
    ['if_statement', 'consequence'],
    ['for_statement', 'body'],
    ['for_in_statement', 'body'],
    ['while_statement', 'body'],
    ['try_statement', 'body'],
  ]),
  callWrapped: new Set(['expression_statement', 'lexical_declaration', 'variable_declaration']),
  wrapper: { before: 'class __Skeleton {\n', after: '\n}\n' },
  indentBased: false,
  alwaysWrap: false,
};

const PROFILES: ReadonlyMap<Language, SyntaxProfile> = new Map<Language, SyntaxProfile>([
  [Language.TypeScript, JS_PROFILE],
  [Language.JavaScript, JS_PROFILE],
  [Language.Java, {
    comment: '//',
    functionTypes: new Set(['method_declaration', 'constructor_declaration']),
    blockTypes: new Set(['block', 'constructor_body']),
    keep: new Set(['return_statement', 'throw_statement']),
    control: new Map([
      ['if_statement', 'consequence'],
      ['for_statement', 'body'],
      ['enhanced_for_statement', 'body'],
      ['while_statement', 'body'],
      ['try_statement', 'body'],
    ]),
    callWrapped: new Set(['expression_statement', 'local_variable_declaration']),
    wrapper: { before: 'class __Skeleton {\n', after: '\n}\n' },
    indentBased: false,
    alwaysWrap: true,
  }],
  [Language.Python, {
    comment: '#',
    functionTypes: new Set(['function_definition']),
    blockTypes: new Set(['block']),
    keep: new Set(['return_statement', 'raise_statement']),
    control: new Map([
      ['if_statement', 'consequence'],
      ['for_statement', 'body'],
      ['while_statement', 'body'],
      ['try_statement', 'body'],
      ['with_statement', 'body'],
    ]),
    callWrapped: new Set(['expression_statement']),
    wrapper: { before: 'class __Skeleton:\n', after: '\n' },
    indentBased: true,
    alwaysWrap: false,
  }],
]);

const MAX_KEPT_STATEMENT_LINES = 6;
const MAX_DEPTH = 2;
const COMMENT_TYPES = new Set(['comment', 'line_comment', 'block_comment']);

function lineIndentAt(source: string, index: number): string {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, index));
  return match ? match[0] : '';
}

function findFunction(node: Node, profile: SyntaxProfile): Node | null {
  if (profile.functionTypes.has(node.type) && node.childForFieldName('body')) return node;
  for (const child of node.namedChildren) {
    const found = findFunction(child, profile);
    if (found) return found;
  }
  return null;
}

function unwrapAwait(node: Node | null): Node | null {
  let current = node;
  while (current && (current.type === 'await_expression' || current.type === 'await' || current.type === 'parenthesized_expression')) {
    current = current.namedChildren[0] ?? null;
  }
  return current;
}

function isCallNode(node: Node | null): boolean {
  const inner = unwrapAwait(node);
  return !!inner && ['call_expression', 'call', 'method_invocation', 'new_expression'].includes(inner.type);
}

function isCallStatement(stmt: Node, profile: SyntaxProfile): boolean {
  if (!profile.callWrapped.has(stmt.type)) return false;
  if (stmt.type === 'expression_statement') {
    const expr = stmt.namedChildren[0] ?? null;
    if (isCallNode(expr)) return true;
    if (expr && ['assignment_expression', 'assignment', 'augmented_assignment_expression'].includes(expr.type)) {
      return isCallNode(expr.childForFieldName('right'));
    }
    return false;
  }
  const declarators = stmt.namedChildren.filter((child) => child.type === 'variable_declarator');
  return declarators.length === 1 && isCallNode(declarators[0]!.childForFieldName('value'));
}

interface RenderState {
  source: string;
  profile: SyntaxProfile;
  kept: number;
  omitted: number;
}

function significantStatements(block: Node): Node[] {
  return block.namedChildren.filter((child) => !COMMENT_TYPES.has(child.type));
}

function renderBlock(block: Node, state: RenderState, depth: number, fallbackIndent: string): { lines: string[]; kept: number } {
  const { source, profile } = state;
  const lines: string[] = [];
  const statements = significantStatements(block);
  const indent = statements[0] ? lineIndentAt(source, statements[0].startIndex) : fallbackIndent;
  let pendingOmitted = 0;
  let keptHere = 0;

  const flush = (): void => {
    if (pendingOmitted === 0) return;
    lines.push(`${indent}${profile.comment} … ${pendingOmitted} statement${pendingOmitted === 1 ? '' : 's'} omitted`);
    state.omitted += pendingOmitted;
    pendingOmitted = 0;
  };
  const keepVerbatim = (stmt: Node): void => {
    const text = source.slice(stmt.startIndex, stmt.endIndex);
    if (text.split('\n').length > MAX_KEPT_STATEMENT_LINES) {
      pendingOmitted += 1;
      return;
    }
    flush();
    lines.push(`${lineIndentAt(source, stmt.startIndex)}${text}`);
    state.kept += 1;
    keptHere += 1;
  };

  for (const stmt of statements) {
    if (profile.keep.has(stmt.type) || isCallStatement(stmt, profile)) {
      keepVerbatim(stmt);
      continue;
    }
    const bodyField = profile.control.get(stmt.type);
    const body = bodyField && depth < MAX_DEPTH ? stmt.childForFieldName(bodyField) : null;
    if (body && profile.blockTypes.has(body.type)) {
      const heading = source.slice(stmt.startIndex, body.startIndex).trimEnd();
      const stmtIndent = lineIndentAt(source, stmt.startIndex);
      const inner = renderBlock(body, state, depth + 1, `${stmtIndent}  `);
      if (inner.kept === 0) {
        pendingOmitted += 1;
        continue;
      }
      flush();
      if (profile.indentBased) {
        lines.push(`${stmtIndent}${heading}`, ...inner.lines);
      } else {
        lines.push(`${stmtIndent}${heading} {`, ...inner.lines, `${stmtIndent}}`);
      }
      state.kept += 1;
      keptHere += 1;
      continue;
    }
    pendingOmitted += 1;
  }
  flush();

  if (profile.indentBased && keptHere === 0 && lines.length > 0) lines.push(`${indent}...`);
  return { lines, kept: keptHere };
}

function indentAll(text: string): string {
  return text.split('\n').map((line) => (line ? `    ${line}` : line)).join('\n');
}

function wrapSource(profile: SyntaxProfile, content: string, wrapped: boolean): { source: string; prefixLength: number } {
  if (!wrapped) return { source: content, prefixLength: 0 };
  const body = profile.indentBased ? indentAll(content) : content;
  return { source: `${profile.wrapper.before}${body}${profile.wrapper.after}`, prefixLength: profile.wrapper.before.length };
}

type Parsed =
  | { ok: true; source: string; target: Node; tree: Tree; prefixLength: number }
  | { ok: false; reason: SkeletonUnsupportedReason };

async function parseAttempt(language: Language, content: string, profile: SyntaxProfile, wrapped: boolean): Promise<Parsed> {
  const { source, prefixLength } = wrapSource(profile, content, wrapped);
  const tree = await parseSource(language, source);
  if (!tree) return { ok: false, reason: 'grammar-unavailable' };
  if (tree.rootNode.hasError) {
    tree.delete();
    return { ok: false, reason: 'parse-error' };
  }
  const target = findFunction(tree.rootNode, profile);
  if (!target) {
    tree.delete();
    return { ok: false, reason: 'no-function-found' };
  }
  return { ok: true, source, target, tree, prefixLength };
}

export interface SkeletonizeInput {
  content: string;
  filePath: string;
  /** Graph node kind. Only function/method/constructor are skeletonized. */
  nodeKind: string;
  language?: Language | null;
}

/** Render a syntax-safe skeleton for one function/method body, or report why not. */
export async function skeletonize(input: SkeletonizeInput): Promise<SkeletonResult> {
  const language = input.language ?? detectLanguage(input.filePath);
  if (!language) return { status: 'unsupported', reason: 'language-unsupported' };
  const capability = getSkeletonCapability(language);
  const profile = PROFILES.get(language);
  if (!capability || !profile) return { status: 'unsupported', reason: 'language-unsupported', language };
  if (!capability.nodeKinds.includes(input.nodeKind)) return { status: 'unsupported', reason: 'node-kind-unsupported', language };

  const content = input.content.replace(/^\n+|\s+$/g, '');
  if (!content) return { status: 'unsupported', reason: 'no-function-found', language };

  const attempts = profile.alwaysWrap
    ? [true]
    : input.nodeKind === 'method' || input.nodeKind === 'constructor'
      ? [true, false]
      : [false, true];

  let lastReason: SkeletonUnsupportedReason = 'parse-error';
  for (const wrapped of attempts) {
    const parsed = await parseAttempt(language, content, profile, wrapped);
    if (!parsed.ok) {
      if (parsed.reason === 'grammar-unavailable') return { status: 'unsupported', reason: parsed.reason, language };
      lastReason = parsed.reason;
      continue;
    }
    try {
      const rendered = renderTarget(language, profile, parsed, wrapped);
      if (rendered.status !== 'ok') return rendered;
      const check = wrapSource(profile, rendered.text, wrapped);
      const checkTree = await parseSource(language, check.source);
      const clean = !!checkTree && !checkTree.rootNode.hasError;
      checkTree?.delete();
      return clean ? rendered : { status: 'unsupported', reason: 'self-check-failed', language };
    } finally {
      parsed.tree.delete();
    }
  }
  return { status: 'unsupported', reason: lastReason, language };
}

function renderTarget(
  language: Language,
  profile: SyntaxProfile,
  parsed: Extract<Parsed, { ok: true }>,
  wrapped: boolean,
): SkeletonResult {
  const { source, target, prefixLength } = parsed;
  const body = target.childForFieldName('body');
  if (!body || !profile.blockTypes.has(body.type)) return { status: 'unsupported', reason: 'no-block-body', language };

  const contentEnd = source.length - (wrapped ? profile.wrapper.after.length : 0);
  const original = source.slice(prefixLength, contentEnd);
  const bodyStart = body.startIndex - prefixLength;
  const bodyEnd = body.endIndex - prefixLength;
  if (bodyStart < 0 || bodyEnd > original.length) return { status: 'unsupported', reason: 'no-block-body', language };

  const tail = original.slice(bodyEnd);
  if (!/^[\s;,)\]]*$/.test(tail)) return { status: 'unsupported', reason: 'trailing-content', language };
  if (significantStatements(body).length === 0) return { status: 'unsupported', reason: 'nothing-to-compress', language };

  const state: RenderState = { source, profile, kept: 0, omitted: 0 };
  const declaration = original.slice(0, bodyStart).replace(/\s+$/, '');
  const targetIndent = lineIndentAt(source, target.startIndex);
  const { lines } = renderBlock(body, state, 0, `${targetIndent}  `);

  let text: string;
  if (profile.indentBased) {
    if (lines.length === 0) lines.push(`${lineIndentAt(source, body.startIndex)}...`);
    text = `${declaration}\n${lines.join('\n')}`;
  } else {
    text = `${declaration} {\n${lines.join('\n')}${lines.length ? '\n' : ''}${targetIndent}}${tail.trim()}`;
  }
  if (profile.indentBased && wrapped) {
    // The class wrapper indented the source by 4; undo it so the output matches the original margin.
    text = text.split('\n').map((line) => (line.startsWith('    ') ? line.slice(4) : line)).join('\n');
  }
  return { status: 'ok', language, text, keptStatements: state.kept, omittedStatements: state.omitted };
}
