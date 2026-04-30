/**
 * Normalize a type string for comparison.
 * Lowercases, removes `[]`, `?`, whitespace, and generic brackets.
 */
function normalizeType(t: string): string {
  return t.toLowerCase().replace(/[\[\]?<>\s]/g, '').trim();
}

/**
 * Jaccard similarity of two sets of normalized type tokens.
 */
export function paramTypeSimilarity(
  paramsA: Array<{ type?: string }>,
  paramsB: Array<{ type?: string }>
): number {
  if (paramsA.length === 0 && paramsB.length === 0) return 1.0;
  if (paramsA.length === 0 || paramsB.length === 0) return 0.0;
  const setA = new Set(paramsA.map(p => normalizeType(p.type ?? '')).filter(Boolean));
  const setB = new Set(paramsB.map(p => normalizeType(p.type ?? '')).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/**
 * Return type similarity.
 * exact = 1.0; compatible (string/String, number/Number, etc.) = 0.8; different = 0.0; missing = 0.5
 */
export function returnTypeSimilarity(typeA?: string, typeB?: string): number {
  if (!typeA || !typeB) return 0.5;
  const a = normalizeType(typeA);
  const b = normalizeType(typeB);
  if (a === b) return 1.0;
  // Compatible pairs
  const compatible: [string, string][] = [
    ['string', 'str'], ['number', 'int'], ['number', 'float'], ['number', 'double'],
    ['boolean', 'bool'], ['void', 'unit'], ['void', 'none'],
  ];
  for (const [x, y] of compatible) {
    if ((a === x && b === y) || (a === y && b === x)) return 0.8;
  }
  return 0.0;
}

/**
 * Parameter count similarity.
 */
export function paramCountSimilarity(countA: number, countB: number): number {
  const maxCount = Math.max(countA, countB, 1);
  return 1 - Math.abs(countA - countB) / maxCount;
}

/**
 * Combined contract similarity score.
 * formula: 0.4*nameSim + 0.3*paramTypeSim + 0.2*returnTypeSim + 0.1*paramCountSim
 * Confidence boost if nameSim > 0.8 AND paramTypeSim > 0.8: multiply by 1.2, clamp 1.0
 */
export function computeContractSimilarity(
  a: { name: string; parameters?: Array<{name:string;type?:string}>; returnType?: string },
  b: { name: string; parameters?: Array<{name:string;type?:string}>; returnType?: string },
  nameSim: number
): number {
  const paramsA = a.parameters ?? [];
  const paramsB = b.parameters ?? [];
  const ptSim = paramTypeSimilarity(paramsA, paramsB);
  const rtSim = returnTypeSimilarity(a.returnType, b.returnType);
  const pcSim = paramCountSimilarity(paramsA.length, paramsB.length);

  let score = 0.4 * nameSim + 0.3 * ptSim + 0.2 * rtSim + 0.1 * pcSim;

  // Confidence boost
  if (nameSim > 0.8 && ptSim > 0.8) {
    score = Math.min(1.0, score * 1.2);
  }

  return score;
}
