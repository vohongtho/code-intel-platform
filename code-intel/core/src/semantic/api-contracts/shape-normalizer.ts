import { createHash } from 'node:crypto';
import type { HttpShapeFieldFact, HttpShapeOrigin } from './types.js';

function normalizeTypeCategoryText(type: HttpShapeFieldFact['type']): string {
  if (!type) return 'unknown';
  if (type.kind === 'nominal' || type.kind === 'generic-application') return type.name ?? type.text;
  return type.kind;
}

export function normalizeShapeFields(fields: readonly HttpShapeFieldFact[]): HttpShapeFieldFact[] {
  return [...fields]
    .map((field) => ({
      key: field.key,
      required: field.required,
      type: field.type,
      nested: field.nested ? normalizeShapeFields(field.nested) : undefined,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function fieldFingerprintPart(field: HttpShapeFieldFact): string {
  const nested = field.nested && field.nested.length > 0 ? `[${field.nested.map(fieldFingerprintPart).join(',')}]` : '';
  return `${field.key}:${field.required ? 'req' : 'opt'}:${normalizeTypeCategoryText(field.type)}${nested}`;
}

/**
 * Stable fingerprint for a request/response shape. Two shapes fingerprint identically iff
 * their normalized field sets (key, requiredness, type category, nested shape) match, or
 * they reference the same named symbol. Used as the join key between HttpRouteFact and its
 * HttpRequestShapeFact/HttpResponseShapeFact instead of duplicating shape data inline.
 */
export function computeShapeFingerprint(origin: HttpShapeOrigin): string {
  let payload: string;
  if (origin.kind === 'symbol') {
    payload = `symbol:${origin.symbolRef}`;
  } else if (origin.kind === 'inline') {
    payload = `inline:${normalizeShapeFields(origin.fields).map(fieldFingerprintPart).join('|')}`;
  } else {
    payload = 'unknown';
  }
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function normalizeStatusVariant(status: number | 'default' | undefined): number | 'default' {
  return status === undefined ? 'default' : status;
}

export function isSuccessStatus(status: number | 'default'): boolean {
  return status === 'default' || (status >= 200 && status < 300);
}

/** True when a field present in `head` was not present (by key) in `base`. */
export function findAddedFields(base: readonly HttpShapeFieldFact[], head: readonly HttpShapeFieldFact[]): HttpShapeFieldFact[] {
  const baseKeys = new Set(base.map((field) => field.key));
  return head.filter((field) => !baseKeys.has(field.key));
}

/** True when a field present in `base` was not present (by key) in `head`. */
export function findRemovedFields(base: readonly HttpShapeFieldFact[], head: readonly HttpShapeFieldFact[]): HttpShapeFieldFact[] {
  const headKeys = new Set(head.map((field) => field.key));
  return base.filter((field) => !headKeys.has(field.key));
}
