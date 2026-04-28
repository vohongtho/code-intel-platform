/**
 * Encrypted `.code-intel/.secrets` store (AES-256-GCM).
 *
 * Layout on disk:
 *   ┌─────────────┬─────────────┬─────────────┬──────────────┐
 *   │  salt(16)   │   iv(12)    │  authTag(16)│  ciphertext  │
 *   └─────────────┴─────────────┴─────────────┴──────────────┘
 *
 * Key derivation: scrypt(password, salt, 32 bytes, N=2^15).
 * Password sources (in order):
 *   1. `CODE_INTEL_SECRET_KEY` env var (caller-supplied)
 *   2. A machine-bound passphrase derived from `os.hostname() + os.userInfo()`
 *      (good enough for local-only persistence; user MUST set the env var
 *      for any networked or shared machine).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { secureMkdir, secureWriteFile, secureChmodFile } from '../shared/fs-secure.js';

const ALG = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
// scrypt cost: read at call time so tests can lower it via CODE_INTEL_SCRYPT_N.
// Default N=2^14 uses ~16MB RAM — well within Node's maxmem defaults.
function getScryptN(): number {
  const v = parseInt(process.env['CODE_INTEL_SCRYPT_N'] ?? '', 10);
  return (Number.isInteger(v) && v >= 1024) ? v : (1 << 14);
}

export interface SecretsBlob {
  [key: string]: string;
}

export function getSecretsPath(): string {
  return (
    process.env['CODE_INTEL_SECRETS_PATH'] ??
    path.join(os.homedir(), '.code-intel', '.secrets')
  );
}

function getMasterPassword(): string {
  const fromEnv = process.env['CODE_INTEL_SECRET_KEY'];
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  // Machine-bound fallback.
  let username = 'unknown';
  try {
    username = os.userInfo().username;
  } catch {
    /* ignore */
  }
  return `code-intel-machine:${os.hostname()}:${username}:${os.platform()}`;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN, { N: getScryptN(), r: 8, p: 1 });
}

export function encryptSecrets(blob: SecretsBlob): Buffer {
  const password = getMasterPassword();
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(blob), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, authTag, ciphertext]);
}

export function decryptSecrets(encrypted: Buffer): SecretsBlob {
  if (encrypted.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error('Secrets blob is truncated or invalid');
  }
  const salt = encrypted.subarray(0, SALT_LEN);
  const iv = encrypted.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const authTag = encrypted.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = encrypted.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const password = getMasterPassword();
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as SecretsBlob;
}

/**
 * Read the on-disk secrets file. Returns `{}` if the file does not exist.
 * Throws if the file exists but is corrupted / wrong key.
 */
export function loadSecrets(secretsPath: string = getSecretsPath()): SecretsBlob {
  if (!fs.existsSync(secretsPath)) return {};
  const blob = fs.readFileSync(secretsPath);
  return decryptSecrets(blob);
}

export function saveSecrets(
  blob: SecretsBlob,
  secretsPath: string = getSecretsPath(),
): void {
  secureMkdir(path.dirname(secretsPath));
  const encrypted = encryptSecrets(blob);
  secureWriteFile(secretsPath, encrypted);
  secureChmodFile(secretsPath);
}

export function setSecret(
  key: string,
  value: string,
  secretsPath: string = getSecretsPath(),
): void {
  const blob = loadSecrets(secretsPath);
  blob[key] = value;
  saveSecrets(blob, secretsPath);
}

export function getSecret(
  key: string,
  secretsPath: string = getSecretsPath(),
): string | undefined {
  return loadSecrets(secretsPath)[key];
}

export function deleteSecret(
  key: string,
  secretsPath: string = getSecretsPath(),
): void {
  const blob = loadSecrets(secretsPath);
  delete blob[key];
  saveSecrets(blob, secretsPath);
}

export function listSecretKeys(secretsPath: string = getSecretsPath()): string[] {
  return Object.keys(loadSecrets(secretsPath));
}
