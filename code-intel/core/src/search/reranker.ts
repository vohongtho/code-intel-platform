/**
 * reranker.ts — Lightweight feature-based re-ranker for code search results.
 *
 * Applied AFTER initial retrieval (BM25 / vector / hybrid) on the top-K candidate set.
 * Uses signals that are too expensive to compute across all N nodes but cheap on top-K.
 *
 * Signals:
 *  1. Name-query affinity  — exact / prefix / camelCase token overlap
 *  2. Snippet term coverage — how many query terms appear in the code snippet
 *  3. Kind preference       — classes/functions ranked above constants/variables
 *  4. Path quality          — test/dist/build paths penalised via a hard multiplier
 *
 * Final score = score × nameKindSnippetMultiplier × pathMultiplier
 *
 * The path multiplier is a HARD factor (not additive bonus) so that test/dist
 * files never beat source files regardless of their raw BM25 score.
 */

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/**
 * Tokenize a string with camelCase and snake_case awareness.
 *
 *   "UserService"   → ["user", "service"]
 *   "hashPassword"  → ["hash", "password"]
 *   "user_service"  → ["user", "service"]
 *   "XMLParser"     → ["xml", "parser"]
 */
export function tokenizeForRerank(text: string): string[] {
  return text
    // Split uppercase acronyms before a capitalized word: "XMLParser" → "XML Parser"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Split camelCase: "camelCase" → "camel Case"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s\-_./:(){}[\]<>,"'`~!@#$%^&*+=|;?\\]+/)
    .filter((t) => t.length >= 2);
}

// ── Kind weights ──────────────────────────────────────────────────────────────

/**
 * Per-kind preference multiplier.
 * Applied as: score × kindWeight (after name/snippet bonuses).
 * Values > 1.0 = boost; < 1.0 = suppress.
 */
export const DEFAULT_KIND_WEIGHTS: Readonly<Record<string, number>> = {
  class:      1.20,
  interface:  1.15,
  function:   1.10,
  method:     1.08,
  type_alias: 1.03,
  enum:       1.02,
  constant:   0.98,
  variable:   0.90,
  file:       0.85,
};

// ── Path quality multipliers ──────────────────────────────────────────────────

/** Hard multipliers applied to path category — these override bonuses from other signals. */
const PATH_MULTIPLIER_TEST   = 0.40;   // test/spec files always rank well below source
const PATH_MULTIPLIER_DIST   = 0.25;   // dist/build/.d.ts files nearly always irrelevant

// ── Public API ────────────────────────────────────────────────────────────────

export interface RerankOptions {
  /**
   * Weight applied to the name-query affinity signal (additive bonus in [0, nameWeight]).
   * Higher = name similarity matters more. Default: 0.4
   */
  nameWeight?: number;
  /**
   * Weight applied to snippet term coverage (additive bonus in [0, snippetWeight]).
   * Higher = results with more query terms in their snippet are boosted more. Default: 0.25
   */
  snippetWeight?: number;
  /**
   * Per-kind multiplier overrides. Merged with DEFAULT_KIND_WEIGHTS.
   * Pass an empty object to use defaults unchanged.
   */
  kindWeights?: Partial<Record<string, number>>;
}

/** Minimum shape required for re-ranking — a strict subset of HybridSearchResult. */
export interface RerankableResult {
  nodeId:   string;
  name:     string;
  kind:     string;
  filePath: string;
  score:    number;
  snippet?: string;
}

/**
 * Re-rank a set of search results using lightweight feature signals.
 *
 * @param query   Original search query string.
 * @param results Candidates from BM25/vector/hybrid retrieval, sorted by retrieval score.
 * @param options Tuning knobs — all optional, safe defaults are provided.
 * @returns New array sorted by re-rank score (descending). Input array is NOT mutated.
 */
export function rerank<T extends RerankableResult>(
  query: string,
  results: T[],
  options: RerankOptions = {},
): T[] {
  if (results.length === 0) return results;

  const {
    nameWeight    = 0.4,
    snippetWeight = 0.25,
    kindWeights   = {},
  } = options;

  const effectiveKindWeights: Record<string, number> = {
    ...(DEFAULT_KIND_WEIGHTS as Record<string, number>),
    ...(kindWeights as Record<string, number>),
  };

  const queryTerms = [...new Set(tokenizeForRerank(query))];
  // If query tokenizes to nothing (e.g. single character), return as-is
  if (queryTerms.length === 0) return results.slice();

  const queryLower = query.toLowerCase();

  const scored: { result: T; finalScore: number }[] = results.map((r) => {
    let bonus = 0;

    // ── Signal 1: Name-query affinity ──────────────────────────────────────
    const nameLower  = r.name.toLowerCase();
    const nameTerms  = tokenizeForRerank(r.name);

    if (nameLower === queryLower) {
      // Exact match: maximum name bonus
      bonus += nameWeight;
    } else if (nameLower.startsWith(queryLower)) {
      // Symbol name starts with the query (e.g. query "auth" → "authenticate")
      bonus += nameWeight * 0.75;
    } else if (queryLower.includes(nameLower) && nameLower.length >= 3) {
      // Query contains the symbol name (e.g. query "user service" → "user")
      bonus += nameWeight * 0.45;
    } else {
      // Token-level overlap — handles camelCase / multi-word queries.
      // e.g. query "user service" → terms ["user","service"] match "UserService"
      const matchCount = queryTerms.filter((t) => nameTerms.includes(t)).length;
      if (matchCount > 0) {
        const overlap = matchCount / queryTerms.length;
        bonus += nameWeight * overlap * 0.6;
      }
    }

    // ── Signal 2: Snippet term coverage ────────────────────────────────────
    if (r.snippet && r.snippet.length > 0) {
      const snippetLower = r.snippet.toLowerCase();
      const hitCount     = queryTerms.filter((t) => snippetLower.includes(t)).length;
      bonus += snippetWeight * (hitCount / queryTerms.length);
    }

    // ── Signal 3: Kind preference (multiplicative) ───────────────────────
    const kw = effectiveKindWeights[r.kind] ?? 1.0;

    // ── Signal 4: Path quality (hard multiplier) ─────────────────────────
    // Normalise path so both 'tests/foo' and '/tests/foo' match the same patterns.
    const fp      = r.filePath;
    const fpNorm  = '/' + fp;
    const isTestPath =
      fpNorm.includes('/test/') || fpNorm.includes('/tests/') ||
      fpNorm.includes('/spec/') || fpNorm.includes('/__tests__/') ||
      fp.includes('.test.') || fp.includes('.spec.');
    const isDistPath =
      fpNorm.includes('/dist/') || fpNorm.includes('/build/') ||
      fp.endsWith('.d.ts')  || fpNorm.includes('/node_modules/');

    const pathMul = isDistPath ? PATH_MULTIPLIER_DIST
                  : isTestPath ? PATH_MULTIPLIER_TEST
                  : 1.0;

    // Clamp additive bonus to [0, nameWeight + snippetWeight]
    const clampedBonus = Math.max(0, Math.min(nameWeight + snippetWeight, bonus));

    const finalScore = r.score * (1 + clampedBonus) * kw * pathMul;

    return { result: r, finalScore };
  });

  return scored
    .sort((a, b) => b.finalScore - a.finalScore)
    .map(({ result, finalScore }) => ({ ...result, score: finalScore }));
}
