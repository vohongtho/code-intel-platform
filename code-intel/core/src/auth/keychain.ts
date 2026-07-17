/**
 * Default CLI secret storage.
 *
 * Secrets are always persisted in the encrypted-file backend so the default
 * install path stays free of optional native keychain dependencies.
 */

import {
  getSecret as getEncryptedSecret,
  setSecret as setEncryptedSecret,
  deleteSecret as deleteEncryptedSecret,
} from './secret-store.js';

export interface KeychainBackendInfo {
  backend: 'encrypted-file';
}

export async function keychainBackend(): Promise<KeychainBackendInfo> {
  return { backend: 'encrypted-file' };
}

export async function setKeychainSecret(account: string, value: string): Promise<KeychainBackendInfo> {
  setEncryptedSecret(account, value);
  return { backend: 'encrypted-file' };
}

export async function getKeychainSecret(account: string): Promise<string | null> {
  const v = getEncryptedSecret(account);
  return v ?? null;
}

export async function deleteKeychainSecret(account: string): Promise<KeychainBackendInfo> {
  try {
    deleteEncryptedSecret(account);
  } catch {
    /* nothing to delete */
  }
  return { backend: 'encrypted-file' };
}

export function _resetKeychainCacheForTests(): void {
  // ponytail: kept for test compatibility. Remove when callers stop importing it.
}
