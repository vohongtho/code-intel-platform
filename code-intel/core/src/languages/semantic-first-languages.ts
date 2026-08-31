import { Language } from '../shared/languages.js';

/**
 * Languages whose knowledge-graph nodes/edges come from `SemanticFact`s
 * (`pipeline/phases/parse-phase.ts` / `parse-phase-parallel.ts`'s
 * `semanticFirst` branch) rather than the independent, non-fact tree-sitter
 * query path (`extractFromTreeAsync`) every other language still uses.
 *
 * This is the single source of truth both parse phases and the
 * dependency-aware incremental system read from — `context.semanticFacts` is
 * populated for every language unconditionally, so anything that trusts a
 * `SemanticDelta` to describe "what changed in the graph" MUST first confirm
 * every touched file is in this set. For any other language, the fact corpus
 * and the real graph are unrelated, and a delta saying "nothing changed"
 * would be silently wrong.
 */
export const SEMANTIC_FIRST_LANGUAGES: ReadonlySet<Language> = new Set([
  Language.TypeScript,
  Language.JavaScript,
  Language.Python,
  Language.Rust,
  Language.HTML,
  Language.Go,
]);
