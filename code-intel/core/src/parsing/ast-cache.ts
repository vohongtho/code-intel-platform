import { Tree } from 'web-tree-sitter';

const DEFAULT_MAX = 500;

export class AstCache {
  private cache = new Map<string, { tree: Tree; accessedAt: number }>();
  private maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX) {
    this.maxEntries = maxEntries;
  }

  get(filePath: string): Tree | undefined {
    const entry = this.cache.get(filePath);
    if (entry) {
      entry.accessedAt = Date.now();
      return entry.tree;
    }
    return undefined;
  }

  set(filePath: string, tree: Tree): void {
    if (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }
    this.cache.set(filePath, { tree, accessedAt: Date.now() });
  }

  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.accessedAt < oldestTime) {
        oldest = key;
        oldestTime = entry.accessedAt;
      }
    }
    if (oldest) {
      this.cache.delete(oldest);
    }
  }
}
