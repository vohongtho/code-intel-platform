/**
 * BackupScheduler — runs automated backups on a configurable daily schedule.
 *
 * Config via env vars:
 *   CODE_INTEL_BACKUP_SCHEDULE_ENABLED  Set to 'true' to enable (disabled by default)
 *   CODE_INTEL_BACKUP_SCHEDULE_HOUR     Hour of day (0-23) to run daily backup (default: 2)
 *   CODE_INTEL_BACKUP_SCHEDULE_REPOS    Comma-separated repo paths to back up.
 *                                       Falls back to workspaceRoot passed to start().
 */
import { BackupService } from './backup-service.js';
import Logger from '../shared/logger.js';

export class BackupScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private svc: BackupService;

  constructor(backupDir?: string) {
    this.svc = new BackupService(backupDir);
  }

  /** Is the scheduler enabled via environment? */
  isEnabled(): boolean {
    return process.env['CODE_INTEL_BACKUP_SCHEDULE_ENABLED'] === 'true';
  }

  /**
   * Start the scheduler. The first backup fires at the next occurrence of
   * CODE_INTEL_BACKUP_SCHEDULE_HOUR (default: 2am), then every 24 hours.
   */
  start(workspaceRoot?: string): void {
    if (!this.isEnabled()) return;

    const hour = parseInt(process.env['CODE_INTEL_BACKUP_SCHEDULE_HOUR'] ?? '2', 10);
    const repoPaths = this._resolveRepoPaths(workspaceRoot);

    if (repoPaths.length === 0) {
      Logger.warn('[backup-scheduler] No repo paths configured — scheduler idle.');
      return;
    }

    const msUntilNext = this._msUntilNextHour(hour);
    Logger.info(
      `[backup-scheduler] Scheduled daily backups at ${hour}:00. ` +
      `Next run in ${Math.round(msUntilNext / 1000 / 60)} min for: ${repoPaths.join(', ')}`,
    );

    this.timer = setTimeout(() => {
      void this._runBackups(repoPaths);
      // After the first run, fire every 24 hours
      this.interval = setInterval(() => {
        void this._runBackups(repoPaths);
      }, 24 * 60 * 60 * 1000);
    }, msUntilNext);
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _runBackups(repoPaths: string[]): Promise<void> {
    for (const repoPath of repoPaths) {
      try {
        const entry = this.svc.createBackup(repoPath);
        Logger.info(`[backup-scheduler] ✓ Backup created for ${repoPath} → ${entry.id} (${(entry.size / 1024).toFixed(1)} KB)`);

        // Apply retention policy after each backup
        const deleted = this.svc.applyRetention();
        if (deleted > 0) {
          Logger.info(`[backup-scheduler] Retention: removed ${deleted} old backup(s).`);
        }
      } catch (err) {
        Logger.warn(`[backup-scheduler] ✗ Backup failed for ${repoPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private _resolveRepoPaths(workspaceRoot?: string): string[] {
    const env = process.env['CODE_INTEL_BACKUP_SCHEDULE_REPOS'];
    if (env) {
      return env.split(',').map((r) => r.trim()).filter(Boolean);
    }
    return workspaceRoot ? [workspaceRoot] : [];
  }

  /** Milliseconds until the next occurrence of the given hour (0-23). */
  private _msUntilNextHour(hour: number): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) {
      // Already passed today — schedule for tomorrow
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  }
}

export function createBackupScheduler(backupDir?: string): BackupScheduler {
  return new BackupScheduler(backupDir);
}
