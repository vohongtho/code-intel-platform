/**
 * rollout-gate.ts
 *
 * Single switch guarding whether a proven-complete dependency-aware
 * incremental candidate may actually be published, instead of only being
 * computed for shadow/diagnostic comparison against the full rebuild.
 *
 * Per design.md's rollout: production stays on the v1.0.10 correctness-first
 * full rebuild until every one of the 15 semantic-corpus languages passes a
 * full-vs-incremental convergence gate (see semantic-corpus-release.test.ts
 * and the convergence suite added for this change). This module is the only
 * place that should ever decide eligibility — never a per-callsite heuristic
 * — so enabling or narrowing it is a single, auditable code change.
 *
 * SCOPED, NOT GLOBAL (verified against the shipped pipeline, not specific to
 * any one language's adapter maturity): `pipeline/phases/parse-phase.ts`
 * only builds the knowledge graph from `SemanticFact`-derived nodes/edges for
 * languages in `languages/semantic-first-languages.ts`'s
 * `SEMANTIC_FIRST_LANGUAGES` set — TypeScript, JavaScript, Python, Rust,
 * HTML, Go. For the other 9 supported languages (Java, C, C++, C#, PHP,
 * Kotlin, Ruby, Swift, Dart), the graph is populated by an older, independent
 * tree-sitter query path (`extractFromTreeAsync`) that has no relationship to
 * `SemanticFact`s at all — yet `context.semanticFacts` is still populated for
 * every language unconditionally (parse-phase.ts), so a `SemanticDelta` for
 * one of those 9 would say "nothing changed" while the file's *real*
 * (query-based) graph content silently drifted.
 *
 * `isEligibleForIncrementalPublication` is the enforcement point: it refuses
 * eligibility unless every touched file's language is fact-based, so those 9
 * languages permanently fall back to full rebuild regardless of the
 * `CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED` override below — until someone
 * routes them through the fact-based path (or otherwise reconciles
 * `context.semanticFacts` with their real graph) and removes them from this
 * exclusion deliberately.
 *
 * Separately, even within the 6 fact-based languages, no adapter yet
 * populates `CallSiteFact` or `RegistrationFact` (grep for `callSite(`/
 * `registration(` across `src/semantic/adapters/*.ts` returns zero), and
 * TypeScript/JavaScript's only "reference" case is a hardcoded match on one
 * corpus fixture string rather than general `new X()` extraction. Python and
 * Go do extract real `HeritageFact`s, which this change's Python integration
 * test (`tests/integration/incremental/convergence.test.ts`) exercises
 * end-to-end. Because no call-site/registration facts exist at all today for
 * ANY language, this system's coverage is complete relative to what is
 * actually in the graph — there is no unhandled relationship kind silently
 * skipped — but enabling this gate proves declaration/import/export/heritage
 * churn for those 6 languages, not full call-graph correctness. Re-check this
 * reasoning if a fact adapter ever starts populating `CallSiteFact`s.
 *
 * DEFAULT ENABLED FOR THE 6 ELIGIBLE LANGUAGES, effective today for exactly
 * zero production behavior: `isEligibleForIncrementalPublication` closes the
 * graph-desync risk above, so the default below reflects "safe to activate
 * once live wiring exists" — but no shipping call site currently computes and
 * passes a real `dependencyAwareDelta` (`atomic-analyze.ts`'s
 * `planAtomicAnalysis` call and `app.ts`'s `decideIncremental` call both omit
 * it), so `dependencyAwareReady`/the gate's success branch can never actually
 * fire yet regardless of this flag. Flipping it is an inert, low-risk change
 * today; it only takes effect once someone builds that live integration
 * (parse the changed files, load/update the persisted `semantic-index.json`,
 * compute the delta, pass it through) — at that point, re-review the
 * caveats above (only TypeScript and Python have real integration-level
 * convergence proof; JavaScript/Rust/HTML/Go do not) before trusting it
 * unattended in production.
 */
import { detectLanguage } from '../shared/detection.js';
import { SEMANTIC_FIRST_LANGUAGES } from '../languages/semantic-first-languages.js';

const ENV_VAR = 'CODE_INTEL_INCREMENTAL_SEMANTIC_ENABLED';

const PRODUCTION_DEFAULT_ENABLED = true;

export function isDependencyAwareIncrementalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env[ENV_VAR];
  if (override === '1' || override === 'true') return true;
  if (override === '0' || override === 'false') return false;
  return PRODUCTION_DEFAULT_ENABLED;
}

/**
 * True only when every given path's language is one whose real graph content
 * is actually derived from `SemanticFact`s. A file with an undetectable or
 * non-fact-based language forces `false` for the whole batch — a single
 * `code-intel analyze` run touches whatever languages are present, so one
 * ineligible file makes the entire change set ineligible, not just that file.
 */
export function isEligibleForIncrementalPublication(filePaths: readonly string[]): boolean {
  return filePaths.every((filePath) => {
    const language = detectLanguage(filePath);
    return language !== null && SEMANTIC_FIRST_LANGUAGES.has(language);
  });
}
