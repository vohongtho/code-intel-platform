import type { CodeNode } from '../shared/graph-types.js';
import type { SymbolSelection } from './contracts.js';

export interface SymbolSelectorIndex {
  byId: Map<string, CodeNode>;
  byQualifiedName: Map<string, readonly string[]>;
  bySimpleName: Map<string, readonly string[]>;
  byOwner: Map<string, readonly string[]>;
  byLegacyId: Map<string, readonly string[]>;
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function metadataString(node: CodeNode, key: string): string | undefined {
  const semantic = node.metadata?.['semantic'];
  if (!semantic || typeof semantic !== 'object') return undefined;
  const value = (semantic as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

function add(map: Map<string, string[]>, key: string | undefined, value: string): void {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

export function buildSelectorIndex(nodes: Iterable<CodeNode>): SymbolSelectorIndex {
  const byId = new Map<string, CodeNode>();
  const byQualifiedName = new Map<string, string[]>();
  const bySimpleName = new Map<string, string[]>();
  const byOwner = new Map<string, string[]>();
  const byLegacyId = new Map<string, string[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    add(byQualifiedName, metadataString(node, 'qualifiedName'), node.id);
    add(bySimpleName, node.name, node.id);
    add(byOwner, metadataString(node, 'ownerRef'), node.id);
    add(byLegacyId, metadataString(node, 'legacyId'), node.id);
  }

  return {
    byId,
    byQualifiedName: new Map([...byQualifiedName.entries()].map(([k, v]) => [k, sortedUnique(v)])),
    bySimpleName: new Map([...bySimpleName.entries()].map(([k, v]) => [k, sortedUnique(v)])),
    byOwner: new Map([...byOwner.entries()].map(([k, v]) => [k, sortedUnique(v)])),
    byLegacyId: new Map([...byLegacyId.entries()].map(([k, v]) => [k, sortedUnique(v)])),
  };
}

export function selectFromIndex(index: SymbolSelectorIndex, selector: string): SymbolSelection {
  const candidates = index.byId.has(selector)
    ? [selector]
    : index.byQualifiedName.get(selector)
      ?? index.byLegacyId.get(selector)
      ?? index.bySimpleName.get(selector)
      ?? index.byOwner.get(selector)
      ?? [];

  if (candidates.length === 1) return { kind: 'exact', id: candidates[0] };
  if (candidates.length > 1) return { kind: 'ambiguous', candidates: [...candidates] };

  const suggestions = sortedUnique([
    ...index.byQualifiedName.keys(),
    ...index.bySimpleName.keys(),
  ]).filter((value) => value.toLowerCase().includes(selector.toLowerCase())).slice(0, 10);

  return { kind: 'missing', suggestions };
}
