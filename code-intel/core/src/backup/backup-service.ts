/**
 * BackupService — creates AES-256-GCM encrypted backups of all code-intel data.
 *
 * Archives: graph.db, vector.db, meta.json, registry, config
 * Encryption: AES-256-GCM with a per-backup random IV
 * Manifest: SHA-256 hash of each file
 * Optional S3 upload: set CODE_INTEL_BACKUP_S3_BUCKET + credentials
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';

// ── S3 configuration ──────────────────────────────────────────────────────────

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export function getS3Config(): S3Config | null {
  const bucket = process.env['CODE_INTEL_BACKUP_S3_BUCKET'];
  const accessKeyId = process.env['CODE_INTEL_BACKUP_S3_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['CODE_INTEL_BACKUP_S3_SECRET_ACCESS_KEY'];
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region: process.env['CODE_INTEL_BACKUP_S3_REGION'] ?? 'us-east-1',
    accessKeyId,
    secretAccessKey,
    prefix: process.env['CODE_INTEL_BACKUP_S3_PREFIX'] ?? 'code-intel-backups/',
  };
}

// ── AWS SigV4 signing (pure Node.js, no extra deps) ───────────────────────────

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf-8').digest();
}

function sha256hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sigV4SigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

interface S3RequestOptions {
  method: string;
  cfg: S3Config;
  key: string;           // S3 object key (without leading /)
  body?: Buffer;
  query?: Record<string, string>;
}

function s3Request(opts: S3RequestOptions): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const { method, cfg, key, body, query } = opts;
    const host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHMMSSz
    const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

    const payloadHash = body ? sha256hex(body) : sha256hex(Buffer.alloc(0));
    const encodedPath = `/${key.split('/').map(encodeURIComponent).join('/')}`;

    const queryStr = query
      ? Object.keys(query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`).join('&')
      : '';

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      method,
      encodedPath,
      queryStr,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256hex(Buffer.from(canonicalRequest, 'utf-8')),
    ].join('\n');

    const signingKey = sigV4SigningKey(cfg.secretAccessKey, dateStamp, cfg.region, 's3');
    const signature = hmac(signingKey, stringToSign).toString('hex');

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const reqPath = encodedPath + (queryStr ? `?${queryStr}` : '');

    const reqOptions: https.RequestOptions = {
      hostname: host,
      path: reqPath,
      method,
      headers: {
        'Host': host,
        'X-Amz-Date': amzDate,
        'X-Amz-Content-Sha256': payloadHash,
        'Authorization': authorization,
        ...(body ? { 'Content-Length': String(body.length) } : {}),
      },
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  files: Array<{ name: string; sha256: string; size: number }>;
  version: string;
}

export interface BackupEntry {
  id: string;
  createdAt: string;
  path: string;
  size: number;
  repoPath: string;
}

const BACKUP_VERSION = '1.0';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;

export function getBackupDir(): string {
  return path.join(os.homedir(), '.code-intel', 'backups');
}

export function getBackupKey(): Buffer {
  const keyHex = process.env['CODE_INTEL_BACKUP_KEY'];
  if (keyHex && keyHex.length >= 64) {
    return Buffer.from(keyHex.slice(0, 64), 'hex');
  }
  // Derive a stable key from machine-specific data (for dev convenience)
  const seed = `code-intel-backup-${os.hostname()}-${os.homedir()}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function encryptBuffer(data: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: [IV (16)] [authTag (16)] [ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBuffer(data: Buffer, key: Buffer): Buffer {
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = data.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export class BackupService {
  private backupDir: string;
  private key: Buffer;

  constructor(backupDir?: string) {
    this.backupDir = backupDir ?? getBackupDir();
    this.key = getBackupKey();
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  /**
   * Create a backup for a repository.
   * Returns the backup entry.
   */
  createBackup(repoPath: string): BackupEntry {
    const codeIntelDir = path.join(repoPath, '.code-intel');
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    // Collect files to backup
    const filesToBackup: Array<{ name: string; localPath: string }> = [];
    const candidates = ['graph.db', 'vector.db', 'meta.json'];
    for (const f of candidates) {
      const fp = path.join(codeIntelDir, f);
      if (fs.existsSync(fp)) {
        filesToBackup.push({ name: f, localPath: fp });
      }
    }

    // Also backup registry + users DB
    const registryPath = path.join(os.homedir(), '.code-intel', 'registry.json');
    if (fs.existsSync(registryPath)) {
      filesToBackup.push({ name: 'registry.json', localPath: registryPath });
    }
    const usersDbPath = path.join(os.homedir(), '.code-intel', 'users.db');
    if (fs.existsSync(usersDbPath)) {
      filesToBackup.push({ name: 'users.db', localPath: usersDbPath });
    }

    if (filesToBackup.length === 0) {
      throw new Error(`No backup files found in ${codeIntelDir}. Run \`code-intel analyze\` first.`);
    }

    // Build manifest
    const manifest: BackupManifest = {
      id,
      createdAt,
      version: BACKUP_VERSION,
      files: filesToBackup.map((f) => {
        const data = fs.readFileSync(f.localPath);
        return {
          name: f.name,
          sha256: crypto.createHash('sha256').update(data).digest('hex'),
          size: data.length,
        };
      }),
    };

    // Pack all into a single encrypted archive (NDJSON-style sections)
    // Format: JSON-header-line\n[file-chunk-1][file-chunk-2]...
    // Each file chunk: [name-len (4 bytes BE)] [name] [data-len (8 bytes BE)] [data]
    const parts: Buffer[] = [];

    // Manifest header
    const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf-8');
    const manifestLenBuf = Buffer.alloc(4);
    manifestLenBuf.writeUInt32BE(manifestBuf.length, 0);
    parts.push(manifestLenBuf, manifestBuf);

    // File sections
    for (const f of filesToBackup) {
      const data = fs.readFileSync(f.localPath);
      const nameBuf = Buffer.from(f.name, 'utf-8');
      const nameLenBuf = Buffer.alloc(2);
      nameLenBuf.writeUInt16BE(nameBuf.length, 0);
      const dataLenBuf = Buffer.alloc(8);
      dataLenBuf.writeBigUInt64BE(BigInt(data.length), 0);
      parts.push(nameLenBuf, nameBuf, dataLenBuf, data);
    }

    const plaintext = Buffer.concat(parts);
    const encrypted = encryptBuffer(plaintext, this.key);

    const backupFileName = `backup-${id}.cib`;
    const backupPath = path.join(this.backupDir, backupFileName);
    fs.writeFileSync(backupPath, encrypted);

    // Write index entry
    const entry: BackupEntry = {
      id,
      createdAt,
      path: backupPath,
      size: encrypted.length,
      repoPath,
    };
    this._appendIndex(entry);

    // Auto-upload to S3 if configured
    if (process.env['CODE_INTEL_BACKUP_S3_AUTO_UPLOAD'] === 'true') {
      this.uploadToS3(entry).catch(() => { /* non-fatal */ });
    }

    return entry;
  }

  // ── S3 methods ─────────────────────────────────────────────────────────────

  /** Returns the parsed S3 config or null if not configured. */
  getS3Config(): S3Config | null {
    return getS3Config();
  }

  /**
   * Upload a local backup file to S3.
   * Returns the S3 object key.
   */
  async uploadToS3(entry: BackupEntry): Promise<string> {
    const cfg = getS3Config();
    if (!cfg) throw new Error('S3 not configured. Set CODE_INTEL_BACKUP_S3_BUCKET, CODE_INTEL_BACKUP_S3_ACCESS_KEY_ID, CODE_INTEL_BACKUP_S3_SECRET_ACCESS_KEY.');

    const fileName = path.basename(entry.path);
    const s3Key = `${cfg.prefix}${fileName}`;
    const body = fs.readFileSync(entry.path);

    const result = await s3Request({ method: 'PUT', cfg, key: s3Key, body });
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`S3 upload failed (HTTP ${result.statusCode}): ${result.body.slice(0, 200)}`);
    }
    return s3Key;
  }

  /**
   * Download a backup from S3 and save to destPath.
   */
  async downloadFromS3(s3Key: string, destPath: string): Promise<void> {
    const cfg = getS3Config();
    if (!cfg) throw new Error('S3 not configured.');

    const result = await s3Request({ method: 'GET', cfg, key: s3Key });
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`S3 download failed (HTTP ${result.statusCode}): ${result.body.slice(0, 200)}`);
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, Buffer.from(result.body, 'binary'));
  }

  /**
   * List backup objects in S3 with the configured prefix.
   */
  async listS3Backups(): Promise<Array<{ key: string; size: number; lastModified: string }>> {
    const cfg = getS3Config();
    if (!cfg) throw new Error('S3 not configured.');

    const result = await s3Request({
      method: 'GET',
      cfg,
      key: '',
      query: { 'list-type': '2', prefix: cfg.prefix },
    });
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`S3 list failed (HTTP ${result.statusCode}): ${result.body.slice(0, 200)}`);
    }

    // Parse S3 LIST XML response (simple regex approach — no xml parser needed)
    const entries: Array<{ key: string; size: number; lastModified: string }> = [];
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match: RegExpExecArray | null;
    while ((match = contentsRegex.exec(result.body)) !== null) {
      const block = match[1]!;
      const keyM = /<Key>(.*?)<\/Key>/.exec(block);
      const sizeM = /<Size>(\d+)<\/Size>/.exec(block);
      const lmM = /<LastModified>(.*?)<\/LastModified>/.exec(block);
      if (keyM && sizeM && lmM) {
        entries.push({ key: keyM[1]!, size: parseInt(sizeM[1]!, 10), lastModified: lmM[1]! });
      }
    }
    return entries;
  }

  /**
   * List all backup entries.
   */
  listBackups(): BackupEntry[] {
    return this._loadIndex();
  }

  /**
   * Restore a backup by ID to the target repo path.
   */
  restoreBackup(backupId: string, targetRepoPath?: string): void {
    const entries = this._loadIndex();
    const entry = entries.find((e) => e.id === backupId);
    if (!entry) {
      throw new Error(`Backup "${backupId}" not found.`);
    }
    if (!fs.existsSync(entry.path)) {
      throw new Error(`Backup file not found at: ${entry.path}`);
    }

    const encrypted = fs.readFileSync(entry.path);
    let plaintext: Buffer;
    try {
      plaintext = decryptBuffer(encrypted, this.key);
    } catch {
      throw new Error(`Backup decryption failed — invalid key or corrupted backup.`);
    }

    // Parse manifest
    let offset = 0;
    const manifestLen = plaintext.readUInt32BE(offset);
    offset += 4;
    const manifestStr = plaintext.subarray(offset, offset + manifestLen).toString('utf-8');
    offset += manifestLen;
    const manifest: BackupManifest = JSON.parse(manifestStr);

    const restoreBase = targetRepoPath ?? entry.repoPath;
    const codeIntelDir = path.join(restoreBase, '.code-intel');
    fs.mkdirSync(codeIntelDir, { recursive: true });

    // Restore files
    for (const fileEntry of manifest.files) {
      const nameLen = plaintext.readUInt16BE(offset);
      offset += 2;
      const name = plaintext.subarray(offset, offset + nameLen).toString('utf-8');
      offset += nameLen;
      const dataLen = Number(plaintext.readBigUInt64BE(offset));
      offset += 8;
      const data = plaintext.subarray(offset, offset + dataLen);
      offset += dataLen;

      // Verify SHA-256
      const expectedHash = fileEntry.sha256;
      const actualHash = crypto.createHash('sha256').update(data).digest('hex');
      if (actualHash !== expectedHash) {
        throw new Error(`SHA-256 mismatch for "${name}". Backup may be corrupted.`);
      }

      // Restore global files to ~/.code-intel/
      let destPath: string;
      if (name === 'registry.json' || name === 'users.db') {
        destPath = path.join(os.homedir(), '.code-intel', name);
      } else {
        destPath = path.join(codeIntelDir, name);
      }
      fs.writeFileSync(destPath, data);
    }
  }

  /**
   * Apply retention policy: keep N daily, M weekly, L monthly backups.
   */
  applyRetention(options = { daily: 7, weekly: 4, monthly: 12 }): number {
    const entries = this._loadIndex()
      .filter((e) => fs.existsSync(e.path))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const keep = new Set<string>();
    const now = new Date();

    // Keep daily (last N days)
    const dailyCutoff = new Date(now);
    dailyCutoff.setDate(dailyCutoff.getDate() - options.daily);
    for (const e of entries) {
      if (new Date(e.createdAt) >= dailyCutoff) keep.add(e.id);
    }

    // Keep weekly (1 per week for last M weeks)
    const weekSeen = new Set<string>();
    for (const e of entries) {
      const d = new Date(e.createdAt);
      const weekKey = `${d.getFullYear()}-W${Math.floor(d.getDate() / 7)}`;
      if (!weekSeen.has(weekKey) && weekSeen.size < options.weekly) {
        weekSeen.add(weekKey);
        keep.add(e.id);
      }
    }

    // Keep monthly (1 per month for last L months)
    const monthSeen = new Set<string>();
    for (const e of entries) {
      const d = new Date(e.createdAt);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (!monthSeen.has(monthKey) && monthSeen.size < options.monthly) {
        monthSeen.add(monthKey);
        keep.add(e.id);
      }
    }

    // Delete backups not in keep set
    let deleted = 0;
    for (const e of entries) {
      if (!keep.has(e.id)) {
        try {
          fs.unlinkSync(e.path);
          deleted++;
        } catch { /* already gone */ }
      }
    }

    // Re-write index with only kept entries
    const kept = entries.filter((e) => keep.has(e.id));
    this._saveIndex(kept);
    return deleted;
  }

  // ── Index helpers ──────────────────────────────────────────────────────────

  private _indexPath(): string {
    return path.join(this.backupDir, 'index.json');
  }

  private _loadIndex(): BackupEntry[] {
    try {
      return JSON.parse(fs.readFileSync(this._indexPath(), 'utf-8')) as BackupEntry[];
    } catch {
      return [];
    }
  }

  private _saveIndex(entries: BackupEntry[]): void {
    fs.writeFileSync(this._indexPath(), JSON.stringify(entries, null, 2));
  }

  private _appendIndex(entry: BackupEntry): void {
    const entries = this._loadIndex();
    entries.push(entry);
    this._saveIndex(entries);
  }
}
