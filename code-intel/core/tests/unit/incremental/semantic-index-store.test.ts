import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeclarationFact } from '../../../src/semantic/facts.js';
import { Language } from '../../../src/shared/languages.js';
import { computeSemanticCompatibility, createSemanticSnapshot } from '../../../src/incremental/semantic-snapshot.js';
import { buildReverseDependencyIndex, lookupConsumers } from '../../../src/incremental/reverse-dependency-index.js';
import { loadSemanticIndexArtifact, saveSemanticIndexArtifact } from '../../../src/incremental/semantic-index-store.js';
import {
  cloneGenerationArtifact,
  createIndexGeneration,
} from '../../../src/storage/index-generation.js';

function range(filePath: string) {
  return { filePath, startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 };
}

function declaration(filePath: string, name: string): DeclarationFact {
  return {
    factId: `decl:${filePath}:${name}`,
    language: Language.TypeScript,
    filePath,
    sourceRange: range(filePath),
    declarationKind: 'class',
    name,
    qualifiedName: name,
    anchors: { identity: range(filePath), render: range(filePath) },
  };
}

describe('semantic-index-store', () => {
  it('returns null for a missing file', () => {
    assert.equal(loadSemanticIndexArtifact('/nonexistent/semantic-index.json'), null);
  });

  it('round-trips snapshot and reverse index through save/load', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-index-store-'));
    try {
      const factsByFile = new Map([['a.ts', [declaration('a.ts', 'Widget')]]]);
      const snapshot = createSemanticSnapshot(factsByFile, computeSemanticCompatibility());
      const reverseIndex = buildReverseDependencyIndex(factsByFile);
      const filePath = path.join(dir, 'semantic-index.json');

      saveSemanticIndexArtifact(filePath, { snapshot, reverseIndex });
      const loaded = loadSemanticIndexArtifact(filePath);

      assert.ok(loaded);
      assert.equal(loaded!.snapshot.fingerprint, snapshot.fingerprint);
      assert.equal(loaded!.reverseIndex.producedByFactId.size, reverseIndex.producedByFactId.size);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives the same clone-on-seed path Generation V2 uses for every other artifact', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-index-generation-'));
    try {
      const factsByFile = new Map([['a.ts', [declaration('a.ts', 'Widget')]], ['b.ts', [declaration('b.ts', 'Gadget')]]]);
      const snapshot = createSemanticSnapshot(factsByFile, computeSemanticCompatibility());
      const reverseIndex = buildReverseDependencyIndex(factsByFile);

      const previousGeneration = createIndexGeneration(repo, 'gen-prev');
      saveSemanticIndexArtifact(previousGeneration.semanticIndexPath, { snapshot, reverseIndex });

      const nextGeneration = createIndexGeneration(repo, 'gen-next', { baseGenerationId: 'gen-prev' });
      cloneGenerationArtifact(previousGeneration.semanticIndexPath, nextGeneration.semanticIndexPath);

      const reloaded = loadSemanticIndexArtifact(nextGeneration.semanticIndexPath);
      assert.ok(reloaded);
      assert.equal(reloaded!.snapshot.fingerprint, snapshot.fingerprint);
      assert.equal(lookupConsumers(reloaded!.reverseIndex, 'call-site', 'Widget').length, 0);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
