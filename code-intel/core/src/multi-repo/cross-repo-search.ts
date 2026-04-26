import type { SearchResult } from '../search/text-search.js';
import { reciprocalRankFusion } from '../search/text-search.js';

export function mergeSearchResults(...perRepoResults: SearchResult[][]): SearchResult[] {
  return reciprocalRankFusion(...perRepoResults);
}
