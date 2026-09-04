/**
 * cache/memory-cache.ts
 *
 * Default `ProgramAnalysisCache` backend: an in-process LRU, the same
 * shape as `parsing/ast-cache.ts`'s `AstCache` — bounded by entry count
 * and, since program-analysis artifacts vary a lot in size (an `ir` for a
 * large function vs. a small `taint-findings` result), also by a rough
 * total-byte budget (`JSON.stringify(value).length` as the size proxy).
 * Process-lifetime only; nothing here is persisted to disk. A future
 * persistent backend can implement the same `ProgramAnalysisCache`
 * interface without callers changing.
 */
import type { ProgramAnalysisArtifactKind } from '../contracts.js';
import { DEFAULT_PROGRAM_ANALYSIS_LIMITS } from '../limits.js';
import type { ProgramAnalysisCache, ProgramAnalysisCacheEntry, ProgramAnalysisCacheStats } from './contracts.js';
import { verifyReadBack } from './read-back.js';

const DEFAULT_MAX_ENTRIES = 5000;

interface InternalEntry {
  entry: ProgramAnalysisCacheEntry<unknown>;
  approxBytes: number;
}

export interface MemoryProgramAnalysisCacheOptions {
  maxEntries?: number;
  maxTotalBytes?: number;
}

function approxByteSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export class MemoryProgramAnalysisCache implements ProgramAnalysisCache {
  private readonly cache = new Map<string, InternalEntry>();
  private readonly maxEntries: number;
  private readonly maxTotalBytes: number;
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;
  private invalidReadBacks = 0;
  private evictions = 0;

  constructor(options: MemoryProgramAnalysisCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_PROGRAM_ANALYSIS_LIMITS.maxArtifactBytes * 100;
  }

  get<T>(artifactId: string): T | undefined {
    const internal = this.cache.get(artifactId);
    if (!internal) {
      this.misses += 1;
      return undefined;
    }
    const verification = verifyReadBack(internal.entry.kind, internal.entry.value);
    if (!verification.valid) {
      this.invalidReadBacks += 1;
      this.deleteInternal(artifactId);
      return undefined;
    }
    // Re-insert to move this key to the end of Map iteration order (most-recently-used) —
    // a wall-clock timestamp would tie on rapid synchronous calls within the same millisecond.
    this.cache.delete(artifactId);
    this.cache.set(artifactId, internal);
    this.hits += 1;
    return internal.entry.value as T;
  }

  set<T>(artifactId: string, kind: ProgramAnalysisArtifactKind, value: T): void {
    this.deleteInternal(artifactId);
    const approxBytes = approxByteSize(value);
    while ((this.cache.size >= this.maxEntries || this.totalBytes + approxBytes > this.maxTotalBytes) && this.cache.size > 0) {
      this.evictLru();
    }
    const internal: InternalEntry = {
      entry: { artifactId, kind, value, storedAt: new Date().toISOString() },
      approxBytes,
    };
    this.cache.set(artifactId, internal);
    this.totalBytes += approxBytes;
  }

  has(artifactId: string): boolean {
    return this.cache.has(artifactId);
  }

  delete(artifactId: string): void {
    this.deleteInternal(artifactId);
  }

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }

  stats(): ProgramAnalysisCacheStats {
    return { size: this.cache.size, hits: this.hits, misses: this.misses, invalidReadBacks: this.invalidReadBacks, evictions: this.evictions };
  }

  private deleteInternal(artifactId: string): void {
    const existing = this.cache.get(artifactId);
    if (!existing) return;
    this.totalBytes -= existing.approxBytes;
    this.cache.delete(artifactId);
  }

  private evictLru(): void {
    // Map iteration order is insertion order, and get()/set() re-insert on
    // touch, so the first key is always the least-recently-used one.
    const oldestId = this.cache.keys().next().value as string | undefined;
    if (oldestId !== undefined) {
      this.deleteInternal(oldestId);
      this.evictions += 1;
    }
  }
}
