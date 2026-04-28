/**
 * OS-keychain abstraction for CLI token storage.
 *
 * Tries — in order:
 *   1. `keytar` (OS keychain on macOS/Windows/Linux) — optional dep
 *   2. Encrypted file fallback at `.code-intel/.secrets` (AES-256-GCM)
 *
 * `keytar` is loaded with a dynamic `import()` so it remains an optional
 * dependency: builds without the native module work fine.
 */

import {
  getSecret as getEncryptedSecret,
  setSecret as setEncryptedSecret,
  deleteSecret as deleteEncryptedSecret,
} from './secret-store.js';

const SERVICE = 'code-intel';

type KeytarLike = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
};

let keytarPromise: Promise<KeytarLike | null> | null = null;

async function getKeytar(): Promise<KeytarLike | null> {
  if (keytarPromise) return keytarPromise;
  keytarPromise = (async () => {
    if (process.env['CODE_INTEL_DISABLE_KEYTAR'] === 'true') return null;
    try {
      // Dynamic import — keytar is an optional native dependency.
      // Use a runtime-only import to avoid TypeScript resolving the module at
      // compile time (no @types/keytar needed).
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const mod = await (new Function('specifier', 'return import(specifier)'))('keytar') as Record<string, unknown>;
      const k = (mod['default'] ?? mod) as KeytarLike;
      // Sanity check the API
      if (typeof k.getPassword === 'function' && typeof k.setPassword === 'function') {
        return k;
      }
      return null;
    } catch {
      // Native binding missing or platform unsupported.
      return null;
    }
  })();
  return keytarPromise;
}

export interface KeychainBackendInfo {
  backend: 'keytar' | 'encrypted-file';
}

export async function keychainBackend(): Promise<KeychainBackendInfo> {
  const k = await getKeytar();
  return { backend: k ? 'keytar' : 'encrypted-file' };
}

export async function setKeychainSecret(account: string, value: string): Promise<KeychainBackendInfo> {
  const k = await getKeytar();
  if (k) {
    await k.setPassword(SERVICE, account, value);
    return { backend: 'keytar' };
  }
  setEncryptedSecret(account, value);
  return { backend: 'encrypted-file' };
}

export async function getKeychainSecret(account: string): Promise<string | null> {
  const k = await getKeytar();
  if (k) {
    return (await k.getPassword(SERVICE, account)) ?? null;
  }
  const v = getEncryptedSecret(account);
  return v ?? null;
}

export async function deleteKeychainSecret(account: string): Promise<KeychainBackendInfo> {
  const k = await getKeytar();
  if (k) {
    await k.deletePassword(SERVICE, account);
    return { backend: 'keytar' };
  }
  try {
    deleteEncryptedSecret(account);
  } catch {
    /* nothing to delete */
  }
  return { backend: 'encrypted-file' };
}

/** For tests: reset the cached keytar promise. */
export function _resetKeychainCacheForTests(): void {
  keytarPromise = null;
}
