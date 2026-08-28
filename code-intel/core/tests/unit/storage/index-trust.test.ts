import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeIndexVersion,
  getDbPath,
  getVectorDbPath,
  saveMetadata,
} from '../../../src/storage/metadata.js';
import { getBm25DbPath } from '../../../src/search/bm25-index.js';
import { verifyIndexTrust, upgradeLegacyIndexMetadata } from '../../../src/storage/index-trust.js';

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-trust-'));
}

function writeArtifact(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'artifact');
}

describe('index trust', () => {
  it('reports missing when no metadata or artifacts exist', () => {
    const root = tempRepo();
    try {
      const result = verifyIndexTrust(root);
      assert.equal(result.state, 'missing');
      assert.equal(result.trusted, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports trusted for a complete matching index', () => {
    const root = tempRepo();
    try {
      writeArtifact(getDbPath(root));
      writeArtifact(getBm25DbPath(root));
      writeArtifact(getVectorDbPath(root));
      const indexedAt = new Date().toISOString();
      const schemaVersion = 1;
      saveMetadata(root, {
        indexedAt,
        schemaVersion,
        indexVersion: computeIndexVersion(root, schemaVersion, indexedAt),
        frameworkFingerprint: 'fp1',
        frameworkDetections: ['express'],
        embeddings: { enabled: true, status: 'ready', provider: 'test', model: 'test', dimension: 3 },
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const result = verifyIndexTrust(root);
      assert.equal(result.state, 'trusted');
      assert.equal(result.trusted, true);
      assert.equal(result.artifacts.graph.state, 'unverified');
      assert.equal(result.artifacts.vector.state, 'unverified');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports corrupt when a required artifact is missing', () => {
    const root = tempRepo();
    try {
      writeArtifact(getDbPath(root));
      const indexedAt = new Date().toISOString();
      saveMetadata(root, {
        indexedAt,
        schemaVersion: 1,
        indexVersion: 'invalid',
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const result = verifyIndexTrust(root);
      assert.equal(result.state, 'corrupt');
      assert.ok(result.reasons.includes('BM25_ARTIFACT_MISSING'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('upgrades legacy metadata with schema and fingerprint', () => {
    const root = tempRepo();
    try {
      writeArtifact(getDbPath(root));
      writeArtifact(getBm25DbPath(root));
      saveMetadata(root, {
        indexedAt: new Date().toISOString(),
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const upgraded = upgradeLegacyIndexMetadata(root, 7);
      assert.equal(upgraded.schemaVersion, 7);
      assert.ok(upgraded.indexVersion);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports stale when framework detections exist but framework fingerprint is missing', () => {
    const root = tempRepo();
    try {
      writeArtifact(getDbPath(root));
      writeArtifact(getBm25DbPath(root));
      const indexedAt = new Date().toISOString();
      saveMetadata(root, {
        indexedAt,
        schemaVersion: 1,
        indexVersion: computeIndexVersion(root, 1, indexedAt),
        frameworkDetections: ['express'],
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const result = verifyIndexTrust(root);
      assert.equal(result.state, 'stale');
      assert.ok(result.reasons.includes('FRAMEWORK_FINGERPRINT_MISSING'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports artifact-specific collapsed and unavailable states', () => {
    const root = tempRepo();
    try {
      writeArtifact(getDbPath(root));
      writeArtifact(getBm25DbPath(root));
      const indexedAt = new Date().toISOString();
      saveMetadata(root, {
        indexedAt,
        schemaVersion: 1,
        indexVersion: computeIndexVersion(root, 1, indexedAt),
        graphVerification: { status: 'collapsed', producedCount: 2, persistedCount: 1 },
        vectorVerification: { status: 'unavailable', producedCount: 0, persistedCount: 0, reason: 'disabled' },
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const result = verifyIndexTrust(root);
      assert.equal(result.state, 'corrupt');
      assert.equal(result.artifacts.graph.state, 'collapsed');
      assert.equal(result.artifacts.vector.state, 'unavailable');
      assert.ok(result.reasons.includes('GRAPH_ARTIFACT_COLLAPSED'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves resolver version and fingerprint in trusted metadata', () => {
    const root = tempRepo();
    try {
      writeArtifact(getDbPath(root));
      writeArtifact(getBm25DbPath(root));
      const indexedAt = new Date().toISOString();
      saveMetadata(root, {
        indexedAt,
        schemaVersion: 1,
        indexVersion: computeIndexVersion(root, 1, indexedAt),
        resolverVersion: 'evidence-based-v1',
        resolverFingerprint: 'resolver-fp-1',
        stats: { nodes: 1, edges: 0, files: 1, duration: 1 },
      });
      const result = verifyIndexTrust(root);
      assert.equal(result.metadata?.resolverVersion, 'evidence-based-v1');
      assert.equal(result.metadata?.resolverFingerprint, 'resolver-fp-1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
