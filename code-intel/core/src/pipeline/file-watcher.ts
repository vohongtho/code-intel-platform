/**
 * FileWatcher — watches a workspace directory for source-file changes.
 *
 * Uses chokidar for cross-platform FSEvents/inotify support.
 * Respects `.codeintelignore` patterns plus a hard-coded default ignore list.
 * Debounces rapid saves into a single onChange batch (default 300ms).
 */

import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import Logger from '../shared/logger.js';

const DEFAULT_IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/*.d.ts',
  '**/.code-intel/**',
  '**/.code-intel-trash*/**',
  '**/coverage/**',
];

export interface FileWatcherOptions {
  /** Debounce window in ms. Default: 300. */
  debounceMs?: number;
  /** Extra patterns to ignore. */
  ignore?: string[];
}

export class FileWatcher {
  private readonly workspaceRoot: string;
  private readonly debounceMs: number;
  private readonly extraIgnore: string[];

  private watcher: chokidar.FSWatcher | null = null;
  private pendingFiles = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private _lastEventAt: number | null = null;

  constructor(workspaceRoot: string, options: FileWatcherOptions = {}) {
    this.workspaceRoot = workspaceRoot;
    this.debounceMs = options.debounceMs ?? 300;
    this.extraIgnore = options.ignore ?? [];
  }

  get isWatching(): boolean {
    return this.watcher !== null;
  }

  get lastEventAt(): number | null {
    return this._lastEventAt;
  }

  /** Start watching. Calls `onChange` with debounced list of changed absolute paths. */
  start(onChange: (changedFiles: string[]) => void): void {
    if (this.watcher) return; // already started

    const ignored = [...DEFAULT_IGNORED, ...this.extraIgnore, ...this.readCodeIntelIgnore()];

    this.watcher = chokidar.watch(this.workspaceRoot, {
      ignored,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 50 },
    });

    const handle = (absPath: string) => {
      this._lastEventAt = Date.now();
      this.pendingFiles.add(absPath);
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const files = [...this.pendingFiles];
        this.pendingFiles.clear();
        this.debounceTimer = null;
        Logger.info(`[watcher] ${files.length} file(s) changed`);
        onChange(files);
      }, this.debounceMs);
    };

    this.watcher
      .on('add',    handle)
      .on('change', handle)
      .on('unlink', handle)
      .on('error',  (err) => Logger.warn('[watcher] error:', err instanceof Error ? err.message : err));

    Logger.info(`[watcher] started: ${this.workspaceRoot}`);
  }

  /** Stop watching and clear pending timers. */
  stop(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    this.pendingFiles.clear();
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
    Logger.info('[watcher] stopped');
  }

  // ── private ─────────────────────────────────────────────────────────────────

  private readCodeIntelIgnore(): string[] {
    const ignoreFile = path.join(this.workspaceRoot, '.codeintelignore');
    try {
      if (!fs.existsSync(ignoreFile)) return [];
      return fs
        .readFileSync(ignoreFile, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    } catch {
      return [];
    }
  }
}
