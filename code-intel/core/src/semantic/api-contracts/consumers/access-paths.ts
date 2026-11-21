import type { SourceRange } from '../../anchors.js';
import { splitTopLevel } from '../producer-common.js';
import { fullApiCoverage, partialApiCoverage } from '../types.js';
import type { ApiBoundaryReason, ApiCertainty, ApiCoverage } from '../types.js';

/** Path segment standing for "any element of an array" — `items[0].price` and
 * `items.map((item) => item.price)` both normalize to `['items', '[]', 'price']`. */
export const ARRAY_ELEMENT_SEGMENT = '[]';

export const ACCESS_PATH_LIMITS = Object.freeze({
  /** Lines scanned after the call site (the scan also stops when the enclosing block closes). */
  maxScanLines: 40,
  /** Alias hops from the response root: `data` (1) -> `user` (2) -> `profile` (3). */
  maxAliasDepth: 3,
  maxPaths: 64,
  maxPathDepth: 8,
});

export interface ConsumerAccessPath {
  path: readonly string[];
  /** True when every observed read of this path guards absence with optional chaining or a
   * destructuring default. */
  optional: boolean;
  /** True when the value at `path` is also used as a whole (returned, passed as an argument,
   * stored), so fields beneath it may be read outside this bounded local scan. */
  wholeValueUse?: boolean;
  sourceRange: SourceRange;
  certainty: ApiCertainty;
}

export interface AccessPathResult {
  paths: readonly ConsumerAccessPath[];
  coverage: ApiCoverage;
}

/** Where tracking starts: a response expression matched by regex source (e.g.
 * `await\\s+res\\.json\\(\\)`, `res\\.data`), or already-bound names such as a subscribe
 * callback's parameter. */
export type AccessPathRoot =
  | { kind: 'expression'; patternSource: string }
  | { kind: 'binding-pattern'; patternText: string; lineIndex: number; declEnd: number };

/** `['user', 'profile', 'displayName']` -> `user.profile.displayName`; `['items', '[]', 'price']`
 * -> `items[].price`. */
export function formatAccessPath(path: readonly string[]): string {
  let text = '';
  for (const segment of path) {
    if (segment === ARRAY_ELEMENT_SEGMENT) text += ARRAY_ELEMENT_SEGMENT;
    else text += text ? `.${segment}` : segment;
  }
  return text;
}

export function parseAccessPath(text: string): string[] {
  const segments: string[] = [];
  for (const part of text.split('.')) {
    const match = part.match(/^([^[]*)((?:\[\])*)$/);
    if (!match) return [];
    if (match[1]) segments.push(match[1]);
    for (let i = 0; i < match[2]!.length / 2; i += 1) segments.push(ARRAY_ELEMENT_SEGMENT);
  }
  return segments;
}

const IDENT = '[A-Za-z_$][\\w$]*';
const IDENT_RE = new RegExp(`^${IDENT}$`);
const ARRAY_CALLBACK_METHODS = new Set(['map', 'forEach', 'filter', 'find', 'findLast', 'some', 'every', 'flatMap', 'sort']);
/** Builtin properties of arrays/strings — never response fields, so they end a path. */
const BUILTIN_PROPERTIES = new Set(['length']);

interface Binding {
  matcher: RegExp;
  path: readonly string[];
  optional: boolean;
  depth: number;
  certainty: ApiCertainty;
  lineIndex: number;
  declEnd: number;
  /** Expression roots (the response itself) are not variables: they can't be reassigned and a
   * bare use means the whole response escapes the scan. */
  isRoot: boolean;
}

interface ChainResult {
  segments: string[];
  optional: boolean;
  /** Index just past the parsed chain. */
  end: number;
  /** Set when the chain ended in a call: the method name and the index just past its `(`. */
  call?: { method: string; argsStart: number };
  dynamic: boolean;
  /** Set when the chain ended at a builtin property (`.length`): the value is no longer a
   * response object, so it must never become an alias. */
  builtin?: boolean;
}

/** Replaces string/template literal contents and trailing `//` comments with spaces, keeping
 * every index stable, so identifier matches never land inside literals. */
function maskLiterals(line: string): string {
  let out = '';
  let quote: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') {
        out += '  ';
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
        out += ch;
      } else {
        out += ' ';
      }
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') return out + ' '.repeat(line.length - i);
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    out += ch;
  }
  return out;
}

/** Parses `.a`, `?.b`, `[0]`, `['c']`, `[key]` starting at `start`. */
function parseChain(text: string, start: number): ChainResult {
  const segments: string[] = [];
  let optional = false;
  let i = start;
  for (;;) {
    const rest = text.slice(i);
    const member = rest.match(new RegExp(`^\\s*(\\?\\.|\\.)\\s*(${IDENT})`));
    if (member) {
      const after = i + member[0].length;
      const callOpen = text.slice(after).match(/^\s*(?:\?\.)?\s*\(/);
      if (callOpen) {
        return { segments, optional, end: after, call: { method: member[2]!, argsStart: after + callOpen[0].length }, dynamic: false };
      }
      if (member[1] === '?.') optional = true;
      if (BUILTIN_PROPERTIES.has(member[2]!)) return { segments, optional, end: after, dynamic: false, builtin: true };
      segments.push(member[2]!);
      i = after;
      continue;
    }
    const bracket = rest.match(/^\s*(\?\.)?\s*\[([^\]]*)\]/);
    if (bracket) {
      if (bracket[1]) optional = true;
      const inner = bracket[2]!.trim();
      const literal = inner.match(/^(['"])(.*)\1$/);
      if (/^\d+$/.test(inner)) segments.push(ARRAY_ELEMENT_SEGMENT);
      else if (literal) segments.push(literal[2]!);
      else return { segments, optional, end: i + bracket[0].length, dynamic: true };
      i += bracket[0].length;
      continue;
    }
    return { segments, optional, end: i, dynamic: false };
  }
}

interface PatternBinding {
  name: string;
  relPath: string[];
  optional: boolean;
}

interface ParsedPattern {
  bindings: PatternBinding[];
  /** Every key path the pattern reads, including intermediate objects of nested patterns. */
  keyPaths: Array<{ relPath: string[]; optional: boolean }>;
  dynamic: boolean;
}

/** Parses an object/array destructuring pattern, or a bare identifier, into bindings relative
 * to the destructured value. Returns undefined for anything it cannot read statically. */
function parsePattern(rawText: string, relBase: string[] = [], depth = 0): ParsedPattern | undefined {
  const text = rawText.trim();
  if (depth > ACCESS_PATH_LIMITS.maxPathDepth) return undefined;
  if (IDENT_RE.test(text)) return { bindings: [{ name: text, relPath: relBase, optional: false }], keyPaths: [], dynamic: false };

  const result: ParsedPattern = { bindings: [], keyPaths: [], dynamic: false };
  if (text.startsWith('[') && text.endsWith(']')) {
    for (const element of splitTopLevel(text.slice(1, -1), ',')) {
      const trimmed = element.trim();
      if (!trimmed) continue;
      const nested = parsePattern(trimmed.replace(/^\.\.\./, '').split('=')[0]!, [...relBase, ARRAY_ELEMENT_SEGMENT], depth + 1);
      if (!nested) return undefined;
      merge(result, nested);
    }
    return result;
  }
  if (!text.startsWith('{') || !text.endsWith('}')) return undefined;

  for (const rawPart of splitTopLevel(text.slice(1, -1), ',')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.startsWith('...')) {
      const restName = part.slice(3).trim();
      if (!IDENT_RE.test(restName)) return undefined;
      result.bindings.push({ name: restName, relPath: relBase, optional: false });
      continue;
    }
    if (part.startsWith('[')) {
      result.dynamic = true;
      continue;
    }
    const colon = topLevelIndexOf(part, ':');
    const rawKey = (colon === -1 ? part.split('=')[0]! : part.slice(0, colon)).trim();
    const key = rawKey.replace(/^(['"])(.*)\1$/, '$2');
    if (!key) return undefined;
    const keyPath = [...relBase, key];
    if (colon === -1) {
      const hasDefault = part.includes('=');
      if (!IDENT_RE.test(key)) return undefined;
      result.bindings.push({ name: key, relPath: keyPath, optional: hasDefault });
      result.keyPaths.push({ relPath: keyPath, optional: hasDefault });
      continue;
    }
    const valueText = part.slice(colon + 1).trim();
    const eq = topLevelIndexOf(valueText, '=');
    const target = (eq === -1 ? valueText : valueText.slice(0, eq)).trim();
    const hasDefault = eq !== -1;
    result.keyPaths.push({ relPath: keyPath, optional: hasDefault });
    const nested = parsePattern(target, keyPath, depth + 1);
    if (!nested) return undefined;
    if (hasDefault) for (const binding of nested.bindings) binding.optional = true;
    merge(result, nested);
  }
  return result;
}

function merge(into: ParsedPattern, from: ParsedPattern): void {
  into.bindings.push(...from.bindings);
  into.keyPaths.push(...from.keyPaths);
  into.dynamic ||= from.dynamic;
}

function topLevelIndexOf(text: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ch && depth === 0 && !(ch === '=' && (text[i + 1] === '=' || text[i + 1] === '>'))) return i;
  }
  return -1;
}

function stripTypeAnnotation(lhs: string): string {
  const trimmed = lhs.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const close = trimmed.startsWith('{') ? '}' : ']';
    let depth = 0;
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed[i] === trimmed[0]) depth += 1;
      else if (trimmed[i] === close) depth -= 1;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
    return trimmed;
  }
  return trimmed.split(':')[0]!.trim();
}

function braceDelta(masked: string): number {
  let delta = 0;
  for (const ch of masked) {
    if (ch === '{') delta += 1;
    else if (ch === '}') delta -= 1;
  }
  return delta;
}

const DECLARATION_HEAD = /^(\s*(?:export\s+)?(const|let|var)\s+)/;
const FOR_OF = new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+(.+?)\\s+of\\s+`);

class AccessPathTracker {
  private readonly bindings: Binding[] = [];
  private readonly recorded = new Map<string, ConsumerAccessPath>();
  private readonly boundaries = new Set<ApiBoundaryReason>();

  constructor(private readonly filePath: string) {}

  addBoundary(reason: ApiBoundaryReason): void {
    this.boundaries.add(reason);
  }

  liveBindingMentioned(masked: string): boolean {
    return this.bindings.some((binding) => {
      binding.matcher.lastIndex = 0;
      return binding.matcher.test(masked);
    });
  }

  addRoot(patternSource: string): void {
    this.bindings.push({
      matcher: new RegExp(`(?<![\\w$.])${patternSource}(?![\\w$])`, 'g'),
      path: [],
      optional: false,
      depth: 0,
      certainty: 'exact',
      lineIndex: -1,
      declEnd: 0,
      isRoot: true,
    });
  }

  bindPattern(patternText: string, base: Binding | { path: readonly string[]; optional: boolean; depth: number; certainty: ApiCertainty }, lineIndex: number, declEnd: number, column: number): void {
    const parsed = parsePattern(patternText);
    if (!parsed) {
      this.addBoundary('local-data-flow-exceeded');
      return;
    }
    if (parsed.dynamic) this.addBoundary('dynamic-computed-access');
    for (const keyPath of parsed.keyPaths) {
      this.record([...base.path, ...keyPath.relPath], base.optional || keyPath.optional, false, lineIndex, column, base.certainty);
    }
    const depth = base.depth + 1;
    if (depth > ACCESS_PATH_LIMITS.maxAliasDepth) {
      this.addBoundary('local-data-flow-exceeded');
      return;
    }
    for (const binding of parsed.bindings) {
      // A re-declared name shadows any earlier binding of the same name.
      this.removeBinding(binding.name);
      this.bindings.push({
        matcher: new RegExp(`(?<![\\w$.])${binding.name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'),
        path: [...base.path, ...binding.relPath],
        optional: base.optional || binding.optional,
        depth,
        certainty: base.certainty,
        lineIndex,
        declEnd,
        isRoot: false,
      });
    }
  }

  private removeBinding(name: string): void {
    const source = `(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`;
    const index = this.bindings.findIndex((binding) => !binding.isRoot && binding.matcher.source === source);
    if (index !== -1) this.bindings.splice(index, 1);
  }

  record(path: readonly string[], optional: boolean, wholeValueUse: boolean, lineIndex: number, column: number, certainty: ApiCertainty): void {
    if (path.length === 0) return;
    let effective = path;
    if (path.length > ACCESS_PATH_LIMITS.maxPathDepth) {
      effective = path.slice(0, ACCESS_PATH_LIMITS.maxPathDepth);
      this.addBoundary('analysis-truncated');
    }
    const key = formatAccessPath(effective);
    const existing = this.recorded.get(key);
    if (existing) {
      this.recorded.set(key, {
        ...existing,
        optional: existing.optional && optional,
        wholeValueUse: existing.wholeValueUse || wholeValueUse || undefined,
      });
      return;
    }
    if (this.recorded.size >= ACCESS_PATH_LIMITS.maxPaths) {
      this.addBoundary('analysis-truncated');
      return;
    }
    const line = lineIndex + 1;
    this.recorded.set(key, {
      path: effective,
      optional,
      wholeValueUse: wholeValueUse || undefined,
      sourceRange: { filePath: this.filePath, startLine: line, startColumn: column, endLine: line, endColumn: column },
      certainty,
    });
  }

  /** Resolves `text` (a declaration's right-hand side) as exactly `<binding><chain>`. */
  private resolveSource(text: string, masked: string, offset: number): { binding: Binding; chain: ChainResult; start: number } | undefined {
    const stripped = text.replace(/\s+as\s+[\w$.<>[\]]+\s*;?\s*$/, '').replace(/;\s*$/, '').trimEnd();
    for (const binding of this.bindings) {
      binding.matcher.lastIndex = 0;
      const match = binding.matcher.exec(masked.slice(offset, offset + stripped.length));
      if (!match) continue;
      const before = stripped.slice(0, match.index).trim();
      if (before !== '' && before !== '(' && before !== 'await') continue;
      let chainStart = match.index + match[0].length;
      if (before === '(') {
        const close = stripped.slice(chainStart).match(/^\s*\)/);
        if (!close) continue;
        chainStart += close[0].length;
      }
      const chain = parseChain(stripped, chainStart);
      if (chain.call || chain.dynamic || chain.builtin || stripped.slice(chain.end).trim() !== '') continue;
      return { binding, chain, start: offset + match.index };
    }
    return undefined;
  }

  scanLine(lineIndex: number, line: string): void {
    const masked = maskLiterals(line);
    const consumedStarts = new Set<number>();

    const declaration = masked.match(DECLARATION_HEAD);
    const assignAt = declaration ? topLevelIndexOf(masked.slice(declaration[0].length), '=') : -1;
    if (declaration && assignAt !== -1) {
      const lhsStart = declaration[0].length;
      const rhsOffset = lhsStart + assignAt + 1 + (masked.slice(lhsStart + assignAt + 1).match(/^\s*/)?.[0].length ?? 0);
      const resolved = this.resolveSource(line.slice(rhsOffset), masked, rhsOffset);
      if (resolved) {
        consumedStarts.add(resolved.start);
        const { binding, chain } = resolved;
        const certainty: ApiCertainty = declaration[2] === 'const' ? binding.certainty : 'candidate';
        const base = { path: [...binding.path, ...chain.segments], optional: binding.optional || chain.optional, depth: binding.depth, certainty };
        this.record(base.path, base.optional, false, lineIndex, resolved.start, certainty);
        this.bindPattern(stripTypeAnnotation(line.slice(lhsStart, lhsStart + assignAt)), base, lineIndex, line.length, lhsStart);
      }
    }

    const forOf = masked.match(FOR_OF);
    if (forOf) {
      const sourceOffset = forOf.index! + forOf[0].length;
      const close = masked.indexOf(')', sourceOffset);
      if (close !== -1) {
        const resolved = this.resolveSource(line.slice(sourceOffset, close), masked, sourceOffset);
        if (resolved) {
          consumedStarts.add(resolved.start);
          const path = [...resolved.binding.path, ...resolved.chain.segments];
          this.record(path, resolved.chain.optional, false, lineIndex, resolved.start, resolved.binding.certainty);
          this.bindPattern(forOf[1]!, { path: [...path, ARRAY_ELEMENT_SEGMENT], optional: resolved.binding.optional, depth: resolved.binding.depth, certainty: resolved.binding.certainty }, lineIndex, close + 1, forOf.index!);
        }
      }
    }

    // Uses. Bindings created while scanning this line (arrow-callback params) are visited too.
    for (let b = 0; b < this.bindings.length; b += 1) {
      const binding = this.bindings[b]!;
      binding.matcher.lastIndex = 0;
      for (const match of masked.matchAll(binding.matcher)) {
        const start = match.index!;
        if (consumedStarts.has(start)) continue;
        if (binding.lineIndex === lineIndex && start < binding.declEnd) continue;
        const end = start + match[0].length;
        const before = masked.slice(0, start);
        const after = masked.slice(end);
        // Object-literal key (`{ user: x }`), not a read of the binding.
        if (/[{,]\s*$/.test(before) && /^\s*:(?!:)/.test(after)) continue;
        if (!binding.isRoot && /^\s*=(?![=>])/.test(after)) {
          // Reassigned: later uses no longer refer to the response.
          this.bindings.splice(b, 1);
          b -= 1;
          break;
        }
        this.recordUse(binding, line, start, end, lineIndex);
      }
    }
  }

  private recordUse(binding: Binding, line: string, start: number, end: number, lineIndex: number): void {
    let chainStart = end;
    if (binding.isRoot && line[start - 1] === '(') {
      const close = line.slice(end).match(/^\s*\)/);
      if (close) chainStart = end + close[0].length;
    }
    const chain = parseChain(line, chainStart);
    const path = [...binding.path, ...chain.segments];
    const optional = binding.optional || chain.optional;

    if (chain.dynamic) {
      this.addBoundary('dynamic-computed-access');
      this.record(path, optional, true, lineIndex, start, binding.certainty);
      return;
    }
    if (chain.call && ARRAY_CALLBACK_METHODS.has(chain.call.method)) {
      this.record(path, optional, false, lineIndex, start, binding.certainty);
      const callback = line.slice(chain.call.argsStart).match(new RegExp(`^\\s*(?:async\\s+)?(\\(\\s*([^)]*?)\\s*\\)|${IDENT})\\s*=>`));
      if (callback) {
        const param = callback[2] !== undefined ? splitTopLevel(callback[2], ',')[0] ?? '' : callback[1]!;
        if (param.trim()) {
          this.bindPattern(param, { path: [...path, ARRAY_ELEMENT_SEGMENT], optional, depth: binding.depth, certainty: binding.certainty }, lineIndex, chain.call.argsStart + callback[0].length, start);
        }
      } else {
        this.record(path, optional, true, lineIndex, start, binding.certainty);
      }
      return;
    }
    if (chain.segments.length === 0 && !chain.call) {
      // Bare use: returned, passed on or stored. The response root escaping means nothing
      // read from it elsewhere is visible here.
      if (binding.isRoot || binding.path.length === 0) this.addBoundary('local-data-flow-exceeded');
      else this.record(path, optional, true, lineIndex, start, binding.certainty);
      return;
    }
    this.record(path, optional, false, lineIndex, start, binding.certainty);
  }

  result(): AccessPathResult {
    const paths = [...this.recorded.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, path]) => path);
    return {
      paths,
      coverage: this.boundaries.size === 0 ? fullApiCoverage() : partialApiCoverage([...this.boundaries]),
    };
  }
}

/**
 * Tracks which response fields a consumer reads, as normalized nested paths, scanning at most
 * ACCESS_PATH_LIMITS.maxScanLines lines from `fromIndex` and stopping when the enclosing block
 * closes. Supports member access, optional chaining, literal bracket access, (nested,
 * renamed, defaulted) destructuring, `for...of` and array-callback element bindings, and alias
 * propagation up to ACCESS_PATH_LIMITS.maxAliasDepth hops. Anything it cannot follow — a
 * computed key, the whole response escaping, a hop past the bound — becomes a coverage
 * boundary, never a silently shorter path list.
 */
export function trackAccessPaths(lines: readonly string[], fromIndex: number, root: AccessPathRoot, filePath: string): AccessPathResult {
  const tracker = new AccessPathTracker(filePath);
  if (root.kind === 'expression') {
    tracker.addRoot(root.patternSource);
  } else {
    const patternText = stripTypeAnnotation(root.patternText.trim().replace(/^\((.*)\)$/s, '$1'));
    tracker.bindPattern(patternText, { path: [], optional: false, depth: 0, certainty: 'exact' }, root.lineIndex, root.declEnd, 0);
  }

  // Callback parameters live only inside the callback: stop once its body closes (or after the
  // first line of a single-line arrow). Expression roots live until the enclosing block closes.
  const callbackScope = root.kind === 'binding-pattern';
  const windowEnd = Math.min(lines.length, fromIndex + ACCESS_PATH_LIMITS.maxScanLines);
  let depth = 0;
  let i = fromIndex;
  for (; i < windowEnd; i += 1) {
    const line = lines[i]!;
    tracker.scanLine(i, line);
    depth += braceDelta(maskLiterals(line));
    if (depth < 0 || (callbackScope && depth <= 0)) break;
  }

  if (i >= windowEnd && windowEnd < lines.length) {
    // Window exhausted while still inside the enclosing block: a later mention of a live
    // binding means reads were missed.
    for (let j = windowEnd; j < Math.min(lines.length, windowEnd + ACCESS_PATH_LIMITS.maxScanLines * 4); j += 1) {
      const masked = maskLiterals(lines[j]!);
      if (tracker.liveBindingMentioned(masked)) {
        tracker.addBoundary('local-data-flow-exceeded');
        break;
      }
      depth += braceDelta(masked);
      if (depth < 0) break;
    }
  }

  return tracker.result();
}
