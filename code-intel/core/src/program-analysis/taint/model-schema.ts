/**
 * taint/model-schema.ts
 *
 * Declarative, versioned taint models: what counts as a source, sink, or
 * sanitizer, expressed as bounded semantic matchers — never executable
 * code and never a regex. A model is plain data validated here before any
 * matcher reaches the engine; an unknown matcher kind, unknown field, or
 * over-budget size fails validation with a path-precise diagnostic
 * instead of being silently dropped (spec: "the matcher is not silently
 * ignored").
 *
 * Matchers evaluate against what the shallow program-analysis IR actually
 * carries for a statement (its primary expression's source text, the
 * function's parameter names) plus optional caller-supplied context
 * (route-handler request parameters, parameter annotations). A matcher
 * kind the current context cannot evaluate simply never matches and is
 * reported as an unevaluated-matcher coverage note by the engine — it
 * never guesses.
 */
import { Language } from '../../shared/languages.js';

export const TAINT_MODEL_SCHEMA_VERSION = 1 as const;

export type TaintMatcherKind =
  | 'qualified-call'
  | 'framework-input'
  | 'annotation'
  | 'field-read'
  | 'return-of'
  | 'literal-call-pattern';

export type TaintRole = 'source' | 'sink' | 'sanitizer';

/** Vulnerability class a sink belongs to; sanitizers declare which classes they clean. `*` (sanitizers only) cleans every class — used for legacy text rules, whose sanitizers always cleaned unconditionally. */
export type TaintCategory = 'sql' | 'command' | 'xss' | 'ssrf' | 'path' | 'code' | 'deserialization' | 'other';
export const TAINT_CATEGORIES: readonly TaintCategory[] = ['sql', 'command', 'xss', 'ssrf', 'path', 'code', 'deserialization', 'other'];

/**
 * How strong the statement-level evidence behind a match is. `syntactic`
 * means the callee/access path matched at identifier-segment boundaries
 * (e.g. callee `child_process.exec` or suffix `.exec` on a segment
 * boundary); `text-fallback` is a raw substring/prefix test (legacy rules
 * and `literal-call-pattern`). Neither is a resolved symbol identity, so a
 * finding built from either stays at most `heuristic` certainty —
 * `matchStrength` only orders/annotates evidence, it never raises
 * certainty (proposal §3).
 */
export type TaintMatchStrength = 'syntactic' | 'text-fallback';

interface MatcherBase {
  id: string;
  /** Sinks: required vulnerability class. Sanitizers: classes this sanitizer cleans (required). Sources: not allowed. */
  category?: TaintCategory;
  categories?: readonly (TaintCategory | '*')[];
  description?: string;
}

/** Callee path (`a.b.c`) equals `callee`, or — with `match: 'suffix'` — ends with it on a `.`/`::` segment boundary. */
export interface QualifiedCallMatcher extends MatcherBase {
  kind: 'qualified-call';
  callee: string;
  match?: 'exact' | 'suffix';
}

/** A read of `<requestParameter>.<accessPath>` inside a function the caller identified as a framework route handler (route fact `handlerRef`). Never matches without that context. */
export interface FrameworkInputMatcher extends MatcherBase {
  kind: 'framework-input';
  framework: string;
  /** Request-object member paths, e.g. `body`, `query`, `params`. Empty means the whole request parameter. */
  accessPaths: readonly string[];
  /** Which handler parameter is the request object (0-based). Defaults to 0. */
  requestParameterIndex?: number;
}

/** Any read of a parameter carrying this annotation/decorator name (e.g. `RequestParam`), as supplied by the caller's parameter-annotation context. Never matches without that context. */
export interface AnnotationMatcher extends MatcherBase {
  kind: 'annotation';
  annotation: string;
}

/** A read whose access path equals `path` or extends it at a segment boundary (e.g. `process.env`, `process.env.HOME`, `request.args.get(...)`). */
export interface FieldReadMatcher extends MatcherBase {
  kind: 'field-read';
  path: string;
}

/** The value produced by calling `callee` (definition statements only: `x = callee(...)`). */
export interface ReturnOfMatcher extends MatcherBase {
  kind: 'return-of';
  callee: string;
  match?: 'exact' | 'suffix';
}

/** Bounded literal text fallback for cases no semantic matcher covers: `substring` (legacy behavior), `prefix`, or `exact` against the statement's primary expression text. */
export interface LiteralCallPatternMatcher extends MatcherBase {
  kind: 'literal-call-pattern';
  text: string;
  mode?: 'substring' | 'prefix' | 'exact';
}

export type TaintSemanticMatcher =
  | QualifiedCallMatcher
  | FrameworkInputMatcher
  | AnnotationMatcher
  | FieldReadMatcher
  | ReturnOfMatcher
  | LiteralCallPatternMatcher;

export interface TaintModel {
  schemaVersion: typeof TAINT_MODEL_SCHEMA_VERSION;
  id: string;
  version: string;
  framework?: string;
  languages?: readonly Language[];
  description?: string;
  sources: readonly TaintSemanticMatcher[];
  sinks: readonly TaintSemanticMatcher[];
  sanitizers: readonly TaintSemanticMatcher[];
}

export interface TaintModelLimits {
  maxModels: number;
  maxMatchersPerModel: number;
  maxIdLength: number;
  maxTextLength: number;
  maxAccessPaths: number;
  maxFileBytes: number;
}

export const DEFAULT_TAINT_MODEL_LIMITS: TaintModelLimits = {
  maxModels: 32,
  maxMatchersPerModel: 256,
  maxIdLength: 128,
  maxTextLength: 256,
  maxAccessPaths: 16,
  maxFileBytes: 256 * 1024,
};

export interface TaintModelDiagnostic {
  /** File/model origin, e.g. `.code-intel/taint-models.json` or `builtin:node-core`. */
  origin: string;
  /** JSON-pointer-like location, e.g. `models[0].sinks[2].kind`. */
  path: string;
  message: string;
  modelId?: string;
  matcherId?: string;
}

export type TaintModelValidation =
  | { valid: true; model: TaintModel; diagnostics: readonly [] }
  | { valid: false; diagnostics: readonly TaintModelDiagnostic[] };

export const TAINT_MATCHER_KINDS: readonly TaintMatcherKind[] = [
  'qualified-call',
  'framework-input',
  'annotation',
  'field-read',
  'return-of',
  'literal-call-pattern',
];

/** Which matcher kinds are meaningful in each role. A sink/sanitizer acts on a call, so read-shaped kinds cannot express one. */
export const MATCHER_KINDS_BY_ROLE: Readonly<Record<TaintRole, ReadonlySet<TaintMatcherKind>>> = {
  source: new Set(TAINT_MATCHER_KINDS),
  sink: new Set(['qualified-call', 'literal-call-pattern']),
  sanitizer: new Set(['qualified-call', 'return-of', 'literal-call-pattern']),
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
/** Dotted/`::` identifier path, optionally starting with `$`/`@`, e.g. `child_process.exec`, `os::system`, `$_GET`. No wildcards or regex metacharacters. */
const PATH_PATTERN = /^[A-Za-z_$@][\w$@]*(?:(?:\.|::|->)[A-Za-z_$@][\w$@]*)*$/;

const COMMON_MATCHER_FIELDS = ['id', 'kind', 'category', 'categories', 'description'];
const MATCHER_FIELDS: Readonly<Record<TaintMatcherKind, readonly string[]>> = {
  'qualified-call': [...COMMON_MATCHER_FIELDS, 'callee', 'match'],
  'framework-input': [...COMMON_MATCHER_FIELDS, 'framework', 'accessPaths', 'requestParameterIndex'],
  annotation: [...COMMON_MATCHER_FIELDS, 'annotation'],
  'field-read': [...COMMON_MATCHER_FIELDS, 'path'],
  'return-of': [...COMMON_MATCHER_FIELDS, 'callee', 'match'],
  'literal-call-pattern': [...COMMON_MATCHER_FIELDS, 'text', 'mode'],
};
const MODEL_FIELDS = ['schemaVersion', 'id', 'version', 'framework', 'languages', 'description', 'sources', 'sinks', 'sanitizers'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class DiagnosticSink {
  readonly items: TaintModelDiagnostic[] = [];
  constructor(private readonly origin: string, private readonly limits: TaintModelLimits) {}

  add(path: string, message: string, ids: { modelId?: string; matcherId?: string } = {}): void {
    this.items.push({ origin: this.origin, path, message, ...ids });
  }

  unknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, ids: { modelId?: string; matcherId?: string } = {}): void {
    for (const key of Object.keys(value).sort()) {
      if (!allowed.includes(key)) this.add(`${path}.${key}`, `unknown field '${key}'`, ids);
    }
  }

  boundedString(value: unknown, path: string, ids: { modelId?: string; matcherId?: string }, options: { required: boolean; pattern?: RegExp; max?: number }): string | undefined {
    if (value === undefined) {
      if (options.required) this.add(path, 'is required', ids);
      return undefined;
    }
    if (typeof value !== 'string' || value.length === 0) {
      this.add(path, 'must be a non-empty string', ids);
      return undefined;
    }
    const max = options.max ?? this.limits.maxTextLength;
    if (value.length > max) {
      this.add(path, `exceeds maximum length ${max}`, ids);
      return undefined;
    }
    if (options.pattern && !options.pattern.test(value)) {
      this.add(path, `has invalid characters (expected ${options.pattern === ID_PATTERN ? 'an identifier: letters, digits, . _ : -' : 'a dotted identifier path without wildcards or regex syntax'})`, ids);
      return undefined;
    }
    return value;
  }
}

function validateCategories(raw: Record<string, unknown>, role: TaintRole, path: string, sink: DiagnosticSink, ids: { modelId?: string; matcherId?: string }): Pick<MatcherBase, 'category' | 'categories'> | null {
  if (role === 'source') {
    if (raw.category !== undefined || raw.categories !== undefined) {
      sink.add(path, 'sources do not take category/categories', ids);
      return null;
    }
    return {};
  }
  if (role === 'sink') {
    if (raw.categories !== undefined) sink.add(`${path}.categories`, 'sinks take a single `category`', ids);
    if (typeof raw.category !== 'string' || !TAINT_CATEGORIES.includes(raw.category as TaintCategory)) {
      sink.add(`${path}.category`, `is required and must be one of ${TAINT_CATEGORIES.join(', ')}`, ids);
      return null;
    }
    return { category: raw.category as TaintCategory };
  }
  if (raw.category !== undefined) sink.add(`${path}.category`, 'sanitizers take `categories` (the vulnerability classes they clean)', ids);
  const categories = raw.categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    sink.add(`${path}.categories`, 'is required: a non-empty list of the vulnerability classes this sanitizer cleans (a sanitizer is never assumed to clean every class)', ids);
    return null;
  }
  const valid = categories.filter((item): item is TaintCategory | '*' => item === '*' || TAINT_CATEGORIES.includes(item as TaintCategory));
  if (valid.length !== categories.length) {
    sink.add(`${path}.categories`, `entries must be one of ${TAINT_CATEGORIES.join(', ')}, or '*'`, ids);
    return null;
  }
  return { categories: [...new Set(valid)].sort() };
}

function validateMatcher(raw: unknown, role: TaintRole, path: string, modelId: string | undefined, sink: DiagnosticSink, limits: TaintModelLimits): TaintSemanticMatcher | null {
  if (!isPlainObject(raw)) {
    sink.add(path, 'must be an object', { modelId });
    return null;
  }
  const matcherId = typeof raw.id === 'string' ? raw.id : undefined;
  const ids = { modelId, matcherId };
  const id = sink.boundedString(raw.id, `${path}.id`, ids, { required: true, pattern: ID_PATTERN, max: limits.maxIdLength });
  const kind = raw.kind;
  if (typeof kind !== 'string' || !TAINT_MATCHER_KINDS.includes(kind as TaintMatcherKind)) {
    sink.add(`${path}.kind`, `unknown matcher kind '${String(kind)}' (supported: ${TAINT_MATCHER_KINDS.join(', ')})`, ids);
    return null;
  }
  const matcherKind = kind as TaintMatcherKind;
  if (!MATCHER_KINDS_BY_ROLE[role].has(matcherKind)) {
    sink.add(`${path}.kind`, `matcher kind '${matcherKind}' cannot be used as a ${role} (allowed: ${[...MATCHER_KINDS_BY_ROLE[role]].join(', ')})`, ids);
    return null;
  }
  const before = sink.items.length;
  sink.unknownFields(raw, MATCHER_FIELDS[matcherKind], path, ids);
  const categories = validateCategories(raw, role, path, sink, ids);
  const description = sink.boundedString(raw.description, `${path}.description`, ids, { required: false });
  const base = { id: id ?? '', ...(categories ?? {}), ...(description ? { description } : {}) };

  let matcher: TaintSemanticMatcher | null = null;
  switch (matcherKind) {
    case 'qualified-call':
    case 'return-of': {
      const callee = sink.boundedString(raw.callee, `${path}.callee`, ids, { required: true, pattern: PATH_PATTERN });
      if (raw.match !== undefined && raw.match !== 'exact' && raw.match !== 'suffix') sink.add(`${path}.match`, "must be 'exact' or 'suffix'", ids);
      if (callee) matcher = { ...base, kind: matcherKind, callee, ...(raw.match ? { match: raw.match as 'exact' | 'suffix' } : {}) };
      break;
    }
    case 'framework-input': {
      const framework = sink.boundedString(raw.framework, `${path}.framework`, ids, { required: true, pattern: ID_PATTERN, max: limits.maxIdLength });
      const accessPaths = raw.accessPaths;
      if (!Array.isArray(accessPaths) || accessPaths.length > limits.maxAccessPaths) {
        sink.add(`${path}.accessPaths`, `must be a list of at most ${limits.maxAccessPaths} member paths`, ids);
        break;
      }
      const paths = accessPaths.map((item, index) => sink.boundedString(item, `${path}.accessPaths[${index}]`, ids, { required: true, pattern: PATH_PATTERN }));
      const index = raw.requestParameterIndex;
      if (index !== undefined && (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 16)) {
        sink.add(`${path}.requestParameterIndex`, 'must be an integer between 0 and 16', ids);
        break;
      }
      if (framework && paths.every((item): item is string => !!item)) {
        matcher = { ...base, kind: 'framework-input', framework, accessPaths: [...paths].sort(), ...(index !== undefined ? { requestParameterIndex: index as number } : {}) };
      }
      break;
    }
    case 'annotation': {
      const annotation = sink.boundedString(raw.annotation, `${path}.annotation`, ids, { required: true, pattern: PATH_PATTERN });
      if (annotation) matcher = { ...base, kind: 'annotation', annotation: annotation.replace(/^@/, '') };
      break;
    }
    case 'field-read': {
      const fieldPath = sink.boundedString(raw.path, `${path}.path`, ids, { required: true, pattern: PATH_PATTERN });
      if (fieldPath) matcher = { ...base, kind: 'field-read', path: fieldPath };
      break;
    }
    case 'literal-call-pattern': {
      const text = sink.boundedString(raw.text, `${path}.text`, ids, { required: true });
      if (raw.mode !== undefined && raw.mode !== 'substring' && raw.mode !== 'prefix' && raw.mode !== 'exact') {
        sink.add(`${path}.mode`, "must be 'substring', 'prefix' or 'exact'", ids);
      }
      if (text) matcher = { ...base, kind: 'literal-call-pattern', text, ...(raw.mode ? { mode: raw.mode as 'substring' | 'prefix' | 'exact' } : {}) };
      break;
    }
  }
  return sink.items.length === before && categories && id ? matcher : null;
}

function validateMatcherList(raw: unknown, role: TaintRole, path: string, modelId: string | undefined, sink: DiagnosticSink, limits: TaintModelLimits): TaintSemanticMatcher[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    sink.add(path, 'must be a list of matchers', { modelId });
    return [];
  }
  return raw.flatMap((item, index) => validateMatcher(item, role, `${path}[${index}]`, modelId, sink, limits) ?? []);
}

function compareMatchers(left: TaintSemanticMatcher, right: TaintSemanticMatcher): number {
  return left.id.localeCompare(right.id);
}

/**
 * Validates one raw model object. Returns a normalized model (matcher
 * lists sorted by id, `languages` sorted) so two models with the same
 * content always fingerprint identically regardless of authoring order.
 */
export function validateTaintModel(raw: unknown, options: { origin: string; path?: string; limits?: TaintModelLimits }): TaintModelValidation {
  const limits = options.limits ?? DEFAULT_TAINT_MODEL_LIMITS;
  const sink = new DiagnosticSink(options.origin, limits);
  const path = options.path ?? 'model';
  if (!isPlainObject(raw)) {
    sink.add(path, 'must be an object');
    return { valid: false, diagnostics: sink.items };
  }
  const modelId = typeof raw.id === 'string' ? raw.id : undefined;
  sink.unknownFields(raw, MODEL_FIELDS, path, { modelId });
  if (raw.schemaVersion !== TAINT_MODEL_SCHEMA_VERSION) {
    sink.add(`${path}.schemaVersion`, `is required and must be ${TAINT_MODEL_SCHEMA_VERSION}`, { modelId });
  }
  const id = sink.boundedString(raw.id, `${path}.id`, { modelId }, { required: true, pattern: ID_PATTERN, max: limits.maxIdLength });
  const version = sink.boundedString(raw.version, `${path}.version`, { modelId }, { required: true, pattern: ID_PATTERN, max: limits.maxIdLength });
  const framework = sink.boundedString(raw.framework, `${path}.framework`, { modelId }, { required: false, pattern: ID_PATTERN, max: limits.maxIdLength });
  const description = sink.boundedString(raw.description, `${path}.description`, { modelId }, { required: false });

  let languages: Language[] | undefined;
  if (raw.languages !== undefined) {
    const known = new Set<string>(Object.values(Language));
    if (!Array.isArray(raw.languages) || raw.languages.some((item) => typeof item !== 'string' || !known.has(item))) {
      sink.add(`${path}.languages`, `must be a list of supported languages (${[...known].join(', ')})`, { modelId });
    } else {
      languages = [...new Set(raw.languages as Language[])].sort();
    }
  }

  const sources = validateMatcherList(raw.sources, 'source', `${path}.sources`, modelId, sink, limits);
  const sinks = validateMatcherList(raw.sinks, 'sink', `${path}.sinks`, modelId, sink, limits);
  const sanitizers = validateMatcherList(raw.sanitizers, 'sanitizer', `${path}.sanitizers`, modelId, sink, limits);

  const total = sources.length + sinks.length + sanitizers.length;
  const rawTotal = [raw.sources, raw.sinks, raw.sanitizers].reduce<number>((count, list) => count + (Array.isArray(list) ? list.length : 0), 0);
  if (Math.max(total, rawTotal) > limits.maxMatchersPerModel) {
    sink.add(path, `declares ${Math.max(total, rawTotal)} matchers; the maximum per model is ${limits.maxMatchersPerModel}`, { modelId });
  }
  if (rawTotal === 0) sink.add(path, 'declares no sources, sinks or sanitizers', { modelId });

  const seenMatcherIds = new Map<string, string>();
  for (const [role, list] of [['sources', sources], ['sinks', sinks], ['sanitizers', sanitizers]] as const) {
    for (const matcher of list) {
      const previous = seenMatcherIds.get(matcher.id);
      if (previous) sink.add(`${path}.${role}`, `duplicate matcher id '${matcher.id}' (already used in ${previous})`, { modelId, matcherId: matcher.id });
      else seenMatcherIds.set(matcher.id, role);
    }
  }

  if (sink.items.length > 0 || !id || !version) return { valid: false, diagnostics: sink.items };
  return {
    valid: true,
    diagnostics: [],
    model: {
      schemaVersion: TAINT_MODEL_SCHEMA_VERSION,
      id,
      version,
      ...(framework ? { framework } : {}),
      ...(languages ? { languages } : {}),
      ...(description ? { description } : {}),
      sources: [...sources].sort(compareMatchers),
      sinks: [...sinks].sort(compareMatchers),
      sanitizers: [...sanitizers].sort(compareMatchers),
    },
  };
}
