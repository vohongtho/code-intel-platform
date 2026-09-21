import type { CodeNode } from '../shared/graph-types.js';
import type { SymbolSelection } from './contracts.js';
import { buildSelectorIndex, selectFromIndex } from './selector-index.js';

export function attachLegacyAliases(node: CodeNode, legacyIds: readonly string[]): CodeNode {
  const existing = node.metadata ?? {};
  const semantic = existing['semantic'];
  const semanticRecord = semantic && typeof semantic === 'object' ? semantic as Record<string, unknown> : {};
  return {
    ...node,
    metadata: {
      ...existing,
      semantic: {
        ...semanticRecord,
        legacyId: legacyIds[0],
        legacyIds: [...legacyIds],
      },
    },
  };
}

export function resolveLegacyAlias(nodes: Iterable<CodeNode>, selector: string): SymbolSelection {
  return selectFromIndex(buildSelectorIndex(nodes), selector);
}
