import type { NormalizedGraph } from './normalizer.js';
import type { EntityChangeKind, EntityDelta } from './types.js';

export interface ContinuityInput {
  base: NormalizedGraph;
  head: NormalizedGraph;
  removed: EntityDelta[];
  added: EntityDelta[];
  /** File-level rename hints from Git (git-materializer.ts `detectRenamedFiles`); optional corroborating evidence only. */
  renamedFiles?: Map<string, string>;
}

function contentFingerprintOf(graph: NormalizedGraph, id: string | undefined): string | undefined {
  if (!id) return undefined;
  return graph.nodesById.get(id)?.properties.contentFingerprint;
}

function groupByFingerprint(
  deltas: EntityDelta[],
  graph: NormalizedGraph,
  idOf: (delta: EntityDelta) => string | undefined,
): Map<string, EntityDelta[]> {
  const groups = new Map<string, EntityDelta[]>();
  for (const delta of deltas) {
    const fingerprint = contentFingerprintOf(graph, idOf(delta));
    if (!fingerprint) continue;
    const key = `${delta.nodeKind}::${fingerprint}`;
    const list = groups.get(key);
    if (list) list.push(delta);
    else groups.set(key, [delta]);
  }
  return groups;
}

/**
 * Correlates `removed` + `added` node deltas into `moved`/`renamed` deltas,
 * but only when continuity is *proven*: an unambiguous one-to-one pairing
 * whose declaration content (a hash of the node's exact source text) is
 * byte-identical on both sides. A shared display name alone is never used as
 * evidence — two same-named-but-differently-implemented symbols (an
 * overridden method, an unrelated same-named helper in a different module)
 * simply never share a content fingerprint, so they are never paired.
 *
 * When multiple removed/added candidates share the same (kind, content
 * fingerprint) — most commonly identical-body overloads, or a trivial/empty
 * body repeated across symbols — pairing would be a guess, so every
 * candidate on both sides is left as its original `removed`/`added` delta,
 * annotated with `continuity: { certainty: 'candidate' }` and the opposite
 * side's candidate IDs, never silently upgraded to a rename.
 */
export function correlateContinuity(input: ContinuityInput): EntityDelta[] {
  const { base, head, removed, added, renamedFiles } = input;

  const removedByFingerprint = groupByFingerprint(removed, base, (d) => d.baseId);
  const addedByFingerprint = groupByFingerprint(added, head, (d) => d.headId);

  const consumedRemoved = new Set<EntityDelta>();
  const consumedAdded = new Set<EntityDelta>();
  const annotated = new Map<EntityDelta, EntityDelta>();
  const merged: EntityDelta[] = [];

  for (const [key, removedGroup] of removedByFingerprint) {
    const addedGroup = addedByFingerprint.get(key);
    if (!addedGroup) continue;

    if (removedGroup.length === 1 && addedGroup.length === 1) {
      const removedDelta = removedGroup[0]!;
      const addedDelta = addedGroup[0]!;
      const sameFile = removedDelta.baseFilePath === addedDelta.headFilePath;
      const evidenceKinds = ['content-fingerprint'];
      const gitCorroborated = !sameFile
        && removedDelta.baseFilePath !== undefined
        && renamedFiles?.get(removedDelta.baseFilePath) === addedDelta.headFilePath;
      if (gitCorroborated) evidenceKinds.push('git-rename-detection');

      const kind: EntityChangeKind = sameFile ? 'renamed' : 'moved';
      merged.push({
        kind,
        nodeKind: addedDelta.nodeKind,
        baseId: removedDelta.baseId,
        headId: addedDelta.headId,
        baseName: removedDelta.baseName,
        headName: addedDelta.headName,
        baseFilePath: removedDelta.baseFilePath,
        headFilePath: addedDelta.headFilePath,
        continuity: {
          certainty: 'proven',
          reason: sameFile
            ? 'Identical declaration content at the same file path under a different canonical identity.'
            : 'Identical declaration content correlated to a different file path.',
          evidenceKinds,
        },
      });
      consumedRemoved.add(removedDelta);
      consumedAdded.add(addedDelta);
      continue;
    }

    // Ambiguous: more than one candidate shares this (kind, content
    // fingerprint) on at least one side. Annotate every candidate with the
    // opposite side's IDs rather than picking a pairing.
    const removedIds = removedGroup.map((d) => d.baseId).filter((id): id is string => Boolean(id));
    const addedIds = addedGroup.map((d) => d.headId).filter((id): id is string => Boolean(id));
    for (const removedDelta of removedGroup) {
      annotated.set(removedDelta, {
        ...removedDelta,
        continuity: { certainty: 'candidate', reason: 'Multiple declarations share identical content across base and head; continuity cannot be proven.', evidenceKinds: ['content-fingerprint-ambiguous'] },
        continuityCandidates: addedIds,
      });
    }
    for (const addedDelta of addedGroup) {
      annotated.set(addedDelta, {
        ...addedDelta,
        continuity: { certainty: 'candidate', reason: 'Multiple declarations share identical content across base and head; continuity cannot be proven.', evidenceKinds: ['content-fingerprint-ambiguous'] },
        continuityCandidates: removedIds,
      });
    }
  }

  const result: EntityDelta[] = [...merged];
  for (const delta of removed) {
    if (consumedRemoved.has(delta)) continue;
    result.push(annotated.get(delta) ?? delta);
  }
  for (const delta of added) {
    if (consumedAdded.has(delta)) continue;
    result.push(annotated.get(delta) ?? delta);
  }
  return result;
}
