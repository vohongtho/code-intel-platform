/**
 * vector-runtime-state.ts
 * 
 * Authoritative vector runtime state resolver for search surfaces.
 * 
 * This module centralizes vector execution eligibility decisions across HTTP search,
 * MCP canonical search execution, group search, and vector-status endpoints.
 * 
 * All vector readiness logic flows through here to ensure consistent fallback behavior
 * and prevent distributed decision-making that can drift over time.
 */
import fs from 'node:fs';
import { VectorIndex } from './vector-index.js';
import type { EmbeddingModelDescriptor } from './embedding-model-registry.js';
import type { EmbeddingFingerprint } from './embedder.js';
import {
  embeddingFingerprintMatches,
  type IndexMetadata,
} from '../storage/metadata.js';

/**
 * Vector execution status categories.
 * 
 * - ready: vector index is valid, compatible, and executable
 * - missing: vector.db does not exist
 * - stale: vector index exists but metadata indicates it needs rebuild
 * - incompatible: fingerprint mismatch (provider/model/dimension changed)
 * - corrupt: vector.db exists but cannot be read or is malformed
 * - empty: vector.db is valid but contains no embeddings
 * - unavailable: vector execution is not available (catch-all)
 */
export type VectorRuntimeStatus =
  | 'ready'
  | 'missing'
  | 'stale'
  | 'incompatible'
  | 'corrupt'
  | 'empty'
  | 'unavailable';

/**
 * Resolved vector runtime state for a single repository.
 * 
 * Consumers should check `ready === true` before attempting vector execution.
 * If not ready, fallback to BM25 and surface `reason` in explanations.
 */
export interface VectorRuntimeState {
  status: VectorRuntimeStatus;
  ready: boolean;
  vectorDbPath?: string;
  descriptor?: EmbeddingModelDescriptor;
  fingerprint?: EmbeddingFingerprint;
  reason?: string;
}

/**
 * Input for resolving vector runtime state.
 */
export interface VectorRuntimeInput {
  vectorDbPath: string;
  descriptor: EmbeddingModelDescriptor;
  runtimeFingerprint: EmbeddingFingerprint;
  metadata?: IndexMetadata;
}

/**
 * Resolve vector runtime state for a repository.
 * 
 * This is the single source of truth for vector execution eligibility.
 * 
 * @param input - paths, descriptor, fingerprint, and metadata
 * @returns resolved state with ready flag and reason
 */
export async function resolveVectorRuntimeState(
  input: VectorRuntimeInput,
): Promise<VectorRuntimeState> {
  const { vectorDbPath, descriptor, runtimeFingerprint, metadata } = input;

  // Check 1: vector.db must exist
  if (!fs.existsSync(vectorDbPath)) {
    return {
      status: 'missing',
      ready: false,
      vectorDbPath,
      descriptor,
      fingerprint: runtimeFingerprint,
      reason: 'Vector index does not exist',
    };
  }

  // Check 2: when embedding metadata exists, search-time vector use must honor it.
  if (metadata?.embeddings) {
    if (metadata.embeddings.enabled !== true) {
      return {
        status: 'unavailable',
        ready: false,
        vectorDbPath,
        descriptor,
        fingerprint: runtimeFingerprint,
        reason: 'Vector index is disabled in published metadata',
      };
    }

    if (metadata.embeddings.status !== 'ready') {
      return {
        status: 'stale',
        ready: false,
        vectorDbPath,
        descriptor,
        fingerprint: runtimeFingerprint,
        reason: 'Vector index is marked stale and requires rebuild',
      };
    }

    if (!embeddingFingerprintMatches(metadata.embeddings, runtimeFingerprint)) {
      return {
        status: 'incompatible',
        ready: false,
        vectorDbPath,
        descriptor,
        fingerprint: runtimeFingerprint,
        reason: `Vector index fingerprint mismatch: expected ${runtimeFingerprint.provider}/${runtimeFingerprint.model}/${runtimeFingerprint.dimension}`,
      };
    }
  }

  // Check 3: read-only probe to verify the index is readable and non-empty
  let idx: VectorIndex | null = null;
  try {
    idx = new VectorIndex(vectorDbPath, descriptor.dimension, { readonly: true });
    await idx.init();
    const built = await idx.isBuilt();
    idx.close();

    if (!built) {
      return {
        status: 'empty',
        ready: false,
        vectorDbPath,
        descriptor,
        fingerprint: runtimeFingerprint,
        reason: 'Vector index is empty or unreadable',
      };
    }

    // All checks passed
    return {
      status: 'ready',
      ready: true,
      vectorDbPath,
      descriptor,
      fingerprint: runtimeFingerprint,
    };
  } catch (err) {
    idx?.close();
    return {
      status: 'corrupt',
      ready: false,
      vectorDbPath,
      descriptor,
      fingerprint: runtimeFingerprint,
      reason: `Vector index is corrupt or unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Helper to check if embeddings should be rebuilt based on metadata and runtime state.
 * 
 * This is used by analyze flows and HTTP initialization to determine if the published
 * vector index is compatible with the current runtime configuration.
 * 
 * @param opts - metadata, runtime fingerprint, and hasVectorDb flag
 * @returns true if embeddings should be rebuilt
 */
export function shouldRebuildEmbeddings(opts: {
  metadata?: IndexMetadata;
  runtime: EmbeddingFingerprint;
  hasVectorDb: boolean;
}): boolean {
  const { metadata, runtime, hasVectorDb } = opts;

  if (!metadata?.embeddings) return false;
  if (!hasVectorDb) return true;
  if (metadata.embeddings.status === 'stale') return true;
  return !embeddingFingerprintMatches(metadata.embeddings, runtime);
}
