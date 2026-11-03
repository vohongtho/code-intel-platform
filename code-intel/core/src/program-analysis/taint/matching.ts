/**
 * taint/matching.ts
 *
 * Evaluates declarative taint matchers (model-schema.ts) against one IR
 * statement's shallow primary expression. Everything here is plain string
 * slicing over at most `MAX_MATCH_TEXT` characters — no regex is built
 * from model content, so no model can become a ReDoS surface.
 *
 * Context-dependent matcher kinds (`framework-input`, `annotation`) only
 * match when the caller supplies the fact they depend on (a route handler's
 * request parameter, a parameter's annotations). Without that context they
 * are "unevaluated", which the engine reports as a coverage note rather
 * than a silent "no source here".
 */
import type { IrExpressionKind, IrStatementKind } from '../ir/contracts.js';
import type { TaintCategory, TaintMatchStrength, TaintRole, TaintSemanticMatcher } from './model-schema.js';

const MAX_MATCH_TEXT = 2048;

/** A matcher bound to the model it came from — the unit the engine evaluates. */
export interface RegisteredTaintMatcher {
  modelId: string;
  modelVersion: string;
  role: TaintRole;
  matcher: TaintSemanticMatcher;
  /** `framework-adapter:<adapterId>@<adapterVersion>`, `builtin`, `project:<file>` or `legacy-rule-set`. */
  origin: string;
}

export interface TaintModelMatch {
  /** `<modelId>/<matcherId>` — globally unique across the merged registry. */
  matcherRef: string;
  modelId: string;
  matcherId: string;
  role: TaintRole;
  strength: TaintMatchStrength;
  category?: TaintCategory;
  categories?: readonly (TaintCategory | '*')[];
  origin: string;
}

/** Caller-supplied facts about the function being analyzed; every field optional. */
export interface TaintFunctionContext {
  parameterNames?: readonly string[];
  /** Frameworks whose route registrations target this function (`[]`: registrations were checked and none do; absent: unknown). */
  routeHandlerFrameworks?: readonly string[];
  /** Parameter name -> annotation/decorator names on that parameter (without `@`). */
  parameterAnnotations?: Readonly<Record<string, readonly string[]>>;
}

export interface StatementMatchInput {
  statementKind: IrStatementKind;
  expressionKind?: IrExpressionKind;
  text?: string;
}

export function matcherRef(modelId: string, matcherId: string): string {
  return `${modelId}/${matcherId}`;
}

function stripLeadingKeywords(text: string): string {
  let current = text.trimStart();
  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(/^(?:await|new|yield|return|try|go|defer)\s+/, '');
    if (next === current) break;
    current = next.trimStart();
  }
  return current;
}

function scanAccessPath(source: string): { path: string; end: number } | undefined {
  let end = 0;
  let path = '';
  while (end < source.length) {
    const ident = /^[A-Za-z_$@][\w$@]*/.exec(source.slice(end));
    if (!ident) break;
    path += ident[0];
    end += ident[0].length;
    const separator = /^\s*(\?\.|\.|::|->)\s*/.exec(source.slice(end));
    if (!separator || !/^[A-Za-z_$@]/.test(source.slice(end + separator[0].length))) break;
    path += separator[1] === '::' ? '::' : '.';
    end += separator[0].length;
  }
  return path ? { path, end } : undefined;
}

/**
 * The leading identifier access path of an expression: `req.body.name` for
 * `req.body.name`, `request.args.get` for `request.args.get('q')`,
 * `os.environ` for `os.environ['HOME']`. Optional chaining and `->`
 * separators normalize to `.`. Returns undefined when the text does not
 * start with an identifier.
 */
export function leadingAccessPath(text: string): string | undefined {
  return scanAccessPath(stripLeadingKeywords(text.slice(0, MAX_MATCH_TEXT)))?.path;
}

/** The callee path of a call expression's text (`db.query` for `await db.query(sql, x)`, `exec` for `exec<T>(cmd)`); undefined when the text is not shaped like a call. */
export function calleePath(text: string): string | undefined {
  const source = stripLeadingKeywords(text.slice(0, MAX_MATCH_TEXT));
  const scanned = scanAccessPath(source);
  if (!scanned) return undefined;
  let cursor = scanned.end;
  while (source[cursor] === ' ' || source[cursor] === '!') cursor += 1;
  if (source[cursor] === '<') {
    let depth = 0;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === '<') depth += 1;
      else if (source[cursor] === '>' && --depth === 0) {
        cursor += 1;
        break;
      }
    }
    while (source[cursor] === ' ') cursor += 1;
  }
  return source[cursor] === '(' ? scanned.path : undefined;
}

function segmentsOf(path: string): string[] {
  return path.split(/\.|::/).filter(Boolean);
}

function pathMatches(actual: string | undefined, expected: string, mode: 'exact' | 'suffix' | 'prefix'): boolean {
  if (!actual) return false;
  const actualSegments = segmentsOf(actual);
  const expectedSegments = segmentsOf(expected);
  if (expectedSegments.length === 0 || actualSegments.length < expectedSegments.length) return false;
  if (mode === 'exact') return actualSegments.length === expectedSegments.length && expectedSegments.every((segment, i) => actualSegments[i] === segment);
  if (mode === 'prefix') return expectedSegments.every((segment, i) => actualSegments[i] === segment);
  const offset = actualSegments.length - expectedSegments.length;
  return expectedSegments.every((segment, i) => actualSegments[offset + i] === segment);
}

const DEFINITION_KINDS: ReadonlySet<IrStatementKind> = new Set(['declaration', 'assignment']);

/**
 * Evaluates one matcher. Returns the match strength, `null` for a definite
 * non-match, or `'unevaluated'` when the matcher depends on context the
 * caller did not supply.
 */
export function evaluateMatcher(
  matcher: TaintSemanticMatcher,
  input: StatementMatchInput,
  context: TaintFunctionContext,
): TaintMatchStrength | null | 'unevaluated' {
  const text = input.text?.slice(0, MAX_MATCH_TEXT);
  if (!text) return null;
  switch (matcher.kind) {
    case 'literal-call-pattern': {
      const mode = matcher.mode ?? 'substring';
      const trimmed = text.trim();
      const hit = mode === 'exact' ? trimmed === matcher.text : mode === 'prefix' ? trimmed.startsWith(matcher.text) : text.includes(matcher.text);
      return hit ? 'text-fallback' : null;
    }
    case 'qualified-call':
      return pathMatches(calleePath(text), matcher.callee, matcher.match ?? 'exact') ? 'syntactic' : null;
    case 'return-of':
      if (!DEFINITION_KINDS.has(input.statementKind)) return null;
      return pathMatches(calleePath(text), matcher.callee, matcher.match ?? 'exact') ? 'syntactic' : null;
    case 'field-read':
      return pathMatches(leadingAccessPath(text), matcher.path, 'prefix') ? 'syntactic' : null;
    case 'framework-input': {
      // undefined = route registrations were not consulted; [] = consulted, this function is no handler of that framework.
      if (!context.routeHandlerFrameworks) return 'unevaluated';
      if (!context.routeHandlerFrameworks.includes(matcher.framework)) return null;
      const requestParameter = context.parameterNames?.[matcher.requestParameterIndex ?? 0];
      if (!requestParameter) return 'unevaluated';
      const accessPath = leadingAccessPath(text);
      if (matcher.accessPaths.length === 0) return pathMatches(accessPath, requestParameter, 'prefix') ? 'syntactic' : null;
      return matcher.accessPaths.some((member) => pathMatches(accessPath, `${requestParameter}.${member}`, 'prefix')) ? 'syntactic' : null;
    }
    case 'annotation': {
      if (context.parameterNames && context.parameterNames.length === 0) return null;
      if (!context.parameterAnnotations) return 'unevaluated';
      if (input.expressionKind !== 'parameter-read' && input.expressionKind !== 'member-read' && input.expressionKind !== 'call') return null;
      const root = segmentsOf(leadingAccessPath(text) ?? '')[0];
      return root && context.parameterAnnotations[root]?.includes(matcher.annotation) ? 'syntactic' : null;
    }
  }
}

export interface MatchRoleResult {
  matches: TaintModelMatch[];
  /** Matcher refs that could not be evaluated for lack of context (deduplicated by the engine). */
  unevaluated: string[];
}

/** Every matcher of `role` that fires on this statement, strongest evidence first, then by matcher ref. */
export function matchTaintRole(
  matchers: readonly RegisteredTaintMatcher[],
  role: TaintRole,
  input: StatementMatchInput,
  context: TaintFunctionContext,
): MatchRoleResult {
  const matches: TaintModelMatch[] = [];
  const unevaluated: string[] = [];
  for (const entry of matchers) {
    if (entry.role !== role) continue;
    const ref = matcherRef(entry.modelId, entry.matcher.id);
    const outcome = evaluateMatcher(entry.matcher, input, context);
    if (outcome === 'unevaluated') {
      unevaluated.push(ref);
      continue;
    }
    if (!outcome) continue;
    matches.push({
      matcherRef: ref,
      modelId: entry.modelId,
      matcherId: entry.matcher.id,
      role,
      strength: outcome,
      ...(entry.matcher.category ? { category: entry.matcher.category } : {}),
      ...(entry.matcher.categories ? { categories: entry.matcher.categories } : {}),
      origin: entry.origin,
    });
  }
  matches.sort((a, b) => (a.strength === b.strength ? a.matcherRef.localeCompare(b.matcherRef) : a.strength === 'syntactic' ? -1 : 1));
  return { matches, unevaluated };
}

/**
 * Top-level argument texts of a call expression (`f(a, g(b, c), "x,y")` ->
 * [`a`, `g(b, c)`, `"x,y"`]). Returns undefined when the text is not a
 * complete call (no callee path, unbalanced/truncated parentheses) — the
 * caller must then treat positional mapping as unknown, never guess it.
 */
export function callArgumentTexts(text: string): string[] | undefined {
  const source = stripLeadingKeywords(text.slice(0, MAX_MATCH_TEXT));
  if (!calleePath(source)) return undefined;
  const open = source.indexOf('(');
  const args: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  for (let i = open + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += source[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        if (ch !== ')') return undefined;
        if (current.trim()) args.push(current.trim());
        else if (args.length > 0) return undefined;
        return args;
      }
      depth -= 1;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else current += ch;
  }
  return undefined;
}

const IDENTIFIER_KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'this', 'self', 'new', 'await', 'typeof', 'in', 'of', 'not', 'and', 'or', 'is', 'lambda']);

/**
 * Identifier reads inside an argument/expression text: names not preceded
 * by `.`/`::`/`->` (members) and not immediately called. Approximates the
 * lowering's identifier scan for statements whose arguments the shallow IR
 * did not capture (declaration/assignment initializers).
 */
export function identifierReads(text: string): string[] {
  const names = new Set<string>();
  const source = text.slice(0, MAX_MATCH_TEXT).replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '""');
  for (const match of source.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const before = source.slice(Math.max(0, match.index! - 2), match.index!);
    if (/(\.|::|->)\s*$/.test(before) || /\.$/.test(before)) continue;
    const after = source.slice(match.index! + match[0].length);
    if (/^\s*\(/.test(after) || IDENTIFIER_KEYWORDS.has(match[0])) continue;
    names.add(match[0]);
  }
  return [...names];
}

/** The single identifier an argument text consists of, or undefined (an expression, spread, literal...). */
export function bareIdentifier(text: string): string | undefined {
  const trimmed = text.trim();
  return /^[A-Za-z_$][\w$]*$/.test(trimmed) && !IDENTIFIER_KEYWORDS.has(trimmed) ? trimmed : undefined;
}
