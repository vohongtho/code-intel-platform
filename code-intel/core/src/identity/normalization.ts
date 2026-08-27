import crypto from 'node:crypto';

export type IdentityJson = null | boolean | number | string | IdentityJson[] | { [key: string]: IdentityJson };

function toIdentityJson(value: unknown): IdentityJson {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toIdentityJson(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([, nested]) => nested !== undefined).map(([key, nested]) => [key, toIdentityJson(nested)]),
    );
  }
  return String(value);
}

function slashPath(value: string): string {
  return value.replace(/\\+/g, '/');
}

export function normalizeRepoRelativePath(filePath: string): string {
  let normalized = slashPath(filePath).trim();
  if (!normalized) return normalized;
  normalized = normalized.replace(/^(?:[A-Za-z]:)?\/+/, '');
  normalized = normalized.replace(/\/\.\//g, '/');
  while (normalized.includes('//')) normalized = normalized.replace(/\/\//g, '/');
  const parts = normalized.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function normalizeOwner(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, '');
  return normalized || undefined;
}

export function normalizeSignatureDiscriminator(value?: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function sortObject(value: { [key: string]: IdentityJson }): { [key: string]: IdentityJson } {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalizeIdentityJson(nested)]),
  );
}

export function normalizeIdentityJson(value: unknown): IdentityJson {
  const json = toIdentityJson(value);
  if (Array.isArray(json)) return json.map((item) => normalizeIdentityJson(item));
  if (!json || typeof json !== 'object') return json;
  return sortObject(json as { [key: string]: IdentityJson });
}

export function stableStringifyIdentity(value: unknown): string {
  return JSON.stringify(normalizeIdentityJson(value));
}

export function hashIdentityPayload(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringifyIdentity(value)).digest('hex');
}
