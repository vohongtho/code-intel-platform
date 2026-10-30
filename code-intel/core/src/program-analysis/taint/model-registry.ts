/**
 * taint/model-registry.ts
 *
 * Merges taint models from every origin into one deterministic registry:
 * built-in runtime models, framework-adapter contributions, then optional
 * project models (model-loader.ts), then — for callers still holding a
 * legacy `TaintRuleSet` — an adapted text-fallback model. Merge rules:
 *
 *  - models are ordered by (origin rank, id, version); matchers keep their
 *    validated id order, so the merged matcher list never depends on load
 *    order;
 *  - the same model id appearing twice is accepted only when it is the
 *    exact same normalized content (an adapter registered twice); any other
 *    duplicate — including a project model reusing a built-in id — fails,
 *    so a project model can never silently replace or weaken a built-in;
 *  - every matcher keeps its model id/version/origin, so a finding always
 *    names the model evidence behind it.
 *
 * `taintModelFingerprint` hashes the normalized models plus each
 * contribution's origin and adapter id/version. It feeds
 * `ProgramAnalysisFingerprint.taintModelFingerprint`, so any model change
 * mints a new program-analysis cache key instead of reusing stale findings.
 */
import { hashIdentityPayload } from '../../identity/normalization.js';
import type { Language } from '../../shared/languages.js';
import type { RegisteredTaintMatcher } from './matching.js';
import { validateTaintModel, type TaintModel, type TaintModelDiagnostic, type TaintRole } from './model-schema.js';
import type { TaintRuleSet } from './contracts.js';
import { BUILTIN_TAINT_MODELS } from './builtin-models.js';
import type { FrameworkTaintContribution } from '../../frameworks/contracts.js';

export const TAINT_MODEL_REGISTRY_VERSION = 'taint-model-registry-v1';

export type TaintModelOriginKind = 'builtin' | 'framework-adapter' | 'project' | 'legacy-rule-set';

const ORIGIN_RANK: Record<TaintModelOriginKind, number> = { builtin: 0, 'framework-adapter': 1, project: 2, 'legacy-rule-set': 3 };

export interface TaintModelSource {
  kind: TaintModelOriginKind;
  model: TaintModel;
  adapterId?: string;
  adapterVersion?: string;
  /** Repo-relative file the model was loaded from (project models). */
  sourcePath?: string;
}

export interface TaintModelSummary {
  id: string;
  version: string;
  origin: string;
  framework?: string;
  languages?: readonly Language[];
  sourceCount: number;
  sinkCount: number;
  sanitizerCount: number;
}

export interface TaintModelRegistry {
  version: string;
  fingerprint: string;
  models: readonly TaintModelSummary[];
  matchers: readonly RegisteredTaintMatcher[];
}

export type TaintModelRegistryResult =
  | { ok: true; registry: TaintModelRegistry }
  | { ok: false; diagnostics: readonly TaintModelDiagnostic[] };

function originLabel(source: TaintModelSource): string {
  switch (source.kind) {
    case 'framework-adapter':
      return `framework-adapter:${source.adapterId ?? 'unknown'}@${source.adapterVersion ?? 'unknown'}`;
    case 'project':
      return `project:${source.sourcePath ?? 'unknown'}`;
    default:
      return source.kind;
  }
}

function compareSources(left: TaintModelSource, right: TaintModelSource): number {
  return (
    ORIGIN_RANK[left.kind] - ORIGIN_RANK[right.kind] ||
    left.model.id.localeCompare(right.model.id) ||
    left.model.version.localeCompare(right.model.version) ||
    originLabel(left).localeCompare(originLabel(right))
  );
}

/** Adapts a legacy text-substring rule set into a `literal-call-pattern` model: same substring semantics, heuristic text-fallback evidence, and sanitizers that clean every category (as legacy sanitizers always did). */
export function legacyRuleSetToModel(ruleSet: TaintRuleSet): TaintModel {
  const safeVersion = ruleSet.version.replace(/[^A-Za-z0-9._:-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'unversioned';
  const toMatcher = (matcher: { id: string; textPattern: string }) => ({ id: matcher.id, kind: 'literal-call-pattern' as const, text: matcher.textPattern, mode: 'substring' as const });
  return {
    schemaVersion: 1,
    id: `legacy-${safeVersion}`,
    version: safeVersion,
    description: `Adapted from legacy TaintRuleSet ${ruleSet.version} (text substring rules).`,
    sources: ruleSet.sources.map(toMatcher),
    sinks: ruleSet.sinks.map((matcher) => ({ ...toMatcher(matcher), category: 'other' as const })),
    sanitizers: ruleSet.sanitizers.map((matcher) => ({ ...toMatcher(matcher), categories: ['*' as const] })),
  };
}

export function frameworkContributionSources(contributions: readonly FrameworkTaintContribution[]): TaintModelSource[] {
  return contributions.map((contribution) => ({
    kind: 'framework-adapter',
    model: contribution.model,
    adapterId: contribution.adapterId,
    adapterVersion: contribution.adapterVersion,
  }));
}

export function builtinTaintModelSources(): TaintModelSource[] {
  return BUILTIN_TAINT_MODELS.map((model) => ({ kind: 'builtin', model }));
}

/**
 * Validates and merges model sources. Built-in and adapter models are
 * re-validated too — they are data like any other, and a malformed
 * built-in must fail loudly in tests rather than skew results.
 */
export function createTaintModelRegistry(sources: readonly TaintModelSource[]): TaintModelRegistryResult {
  const diagnostics: TaintModelDiagnostic[] = [];
  const validated: TaintModelSource[] = [];
  for (const source of sources) {
    const result = validateTaintModel(source.model, { origin: originLabel(source), path: `model(${source.model?.id ?? '?'})` });
    if (!result.valid) diagnostics.push(...result.diagnostics);
    else validated.push({ ...source, model: result.model });
  }

  validated.sort(compareSources);
  const byId = new Map<string, TaintModelSource>();
  const merged: TaintModelSource[] = [];
  for (const source of validated) {
    const existing = byId.get(source.model.id);
    if (!existing) {
      byId.set(source.model.id, source);
      merged.push(source);
      continue;
    }
    if (hashIdentityPayload(existing.model) === hashIdentityPayload(source.model)) continue;
    diagnostics.push({
      origin: originLabel(source),
      path: `model(${source.model.id})`,
      modelId: source.model.id,
      message: existing.kind !== 'project' && source.kind === 'project'
        ? `model id '${source.model.id}' is already defined by ${originLabel(existing)}; project models cannot replace built-in or framework models — choose a different id`
        : `duplicate model id '${source.model.id}' with different content (${originLabel(existing)} version ${existing.model.version} vs version ${source.model.version})`,
    });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const matchers: RegisteredTaintMatcher[] = [];
  for (const source of merged) {
    const origin = originLabel(source);
    for (const [role, list] of [['source', source.model.sources], ['sink', source.model.sinks], ['sanitizer', source.model.sanitizers]] as const) {
      for (const matcher of list) matchers.push({ modelId: source.model.id, modelVersion: source.model.version, role: role as TaintRole, matcher, origin });
    }
  }

  const fingerprint = hashIdentityPayload({
    registryVersion: TAINT_MODEL_REGISTRY_VERSION,
    models: merged.map((source) => ({
      kind: source.kind,
      adapterId: source.adapterId ?? null,
      adapterVersion: source.adapterVersion ?? null,
      model: source.model,
    })),
  });

  return {
    ok: true,
    registry: {
      version: TAINT_MODEL_REGISTRY_VERSION,
      fingerprint,
      models: merged.map((source) => ({
        id: source.model.id,
        version: source.model.version,
        origin: originLabel(source),
        ...(source.model.framework ? { framework: source.model.framework } : {}),
        ...(source.model.languages ? { languages: source.model.languages } : {}),
        sourceCount: source.model.sources.length,
        sinkCount: source.model.sinks.length,
        sanitizerCount: source.model.sanitizers.length,
      })),
      matchers,
    },
  };
}

/** Matchers that apply to `language`: models without a `languages` list apply everywhere. */
export function matchersForLanguage(registry: TaintModelRegistry, language: Language): RegisteredTaintMatcher[] {
  const languagesByModel = new Map(registry.models.map((model) => [model.id, model.languages]));
  return registry.matchers.filter((entry) => {
    const languages = languagesByModel.get(entry.modelId);
    return !languages || languages.includes(language);
  });
}

/** Builds a registry straight from a legacy `TaintRuleSet` (compatibility path for existing callers). */
export function registryFromLegacyRuleSet(ruleSet: TaintRuleSet): TaintModelRegistry {
  const result = createTaintModelRegistry([{ kind: 'legacy-rule-set', model: legacyRuleSetToModel(ruleSet) }]);
  if (!result.ok) {
    throw new Error(`invalid legacy taint rule set ${ruleSet.version}: ${result.diagnostics.map((item) => `${item.path}: ${item.message}`).join('; ')}`);
  }
  return result.registry;
}
