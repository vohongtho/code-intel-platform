/**
 * semantic-index-store.ts
 *
 * Persists the SemanticSnapshot + ReverseDependencyIndex pair as a single
 * `semantic-index.json` Generation V2 artifact, using the same staging/
 * clone/publish/abort lifecycle as graph.db/bm25.db/vector.db/evidence.db —
 * no separate mutation pathway.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  parseSemanticSnapshot,
  serializeSemanticSnapshot,
  type SemanticSnapshot,
} from './semantic-snapshot.js';
import {
  parseReverseDependencyIndex,
  serializeReverseDependencyIndex,
  type ReverseDependencyIndex,
} from './reverse-dependency-index.js';

export interface SemanticIndexArtifact {
  snapshot: SemanticSnapshot;
  reverseIndex: ReverseDependencyIndex;
}

export function loadSemanticIndexArtifact(filePath: string): SemanticIndexArtifact | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: { snapshot?: string; reverseIndex?: string };
  try {
    parsed = JSON.parse(raw) as { snapshot?: string; reverseIndex?: string };
  } catch {
    return null;
  }
  if (typeof parsed.snapshot !== 'string' || typeof parsed.reverseIndex !== 'string') return null;
  const snapshot = parseSemanticSnapshot(parsed.snapshot);
  const reverseIndex = parseReverseDependencyIndex(parsed.reverseIndex);
  if (!snapshot || !reverseIndex) return null;
  return { snapshot, reverseIndex };
}

export function saveSemanticIndexArtifact(filePath: string, artifact: SemanticIndexArtifact): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify({
    snapshot: serializeSemanticSnapshot(artifact.snapshot),
    reverseIndex: serializeReverseDependencyIndex(artifact.reverseIndex),
  });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, filePath);
}
