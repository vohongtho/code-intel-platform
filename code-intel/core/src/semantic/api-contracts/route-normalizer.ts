import type { HttpMethod, HttpMethodOrAny } from './types.js';

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function normalizeHttpMethod(method: string | undefined): HttpMethodOrAny {
  if (!method) return 'ANY';
  const upper = method.trim().toUpperCase();
  if (upper === 'ALL' || upper === '*') return 'ANY';
  return (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : 'ANY';
}

export interface NormalizedPathSegment {
  text: string;
  isParameter: boolean;
  paramName?: string;
  isDynamic: boolean;
}

export interface NormalizedRoutePath {
  normalizedPath: string;
  segments: readonly NormalizedPathSegment[];
  hasDynamicPrefix: boolean;
}

// Parameter spellings across the frameworks in scope: :id (Express/Fastify/Nest),
// {id} (ASP.NET Core / OpenAPI-style), <id> (some other stacks).
const PARAM_PATTERNS: readonly RegExp[] = [/^:([A-Za-z_]\w*)$/, /^\{([A-Za-z_]\w*)\}$/, /^<([A-Za-z_]\w*)>$/];

function parseSegment(segment: string): NormalizedPathSegment {
  for (const pattern of PARAM_PATTERNS) {
    const match = segment.match(pattern);
    if (match) {
      return { text: segment, isParameter: true, paramName: match[1], isDynamic: false };
    }
  }
  // A segment containing an unresolved template/expression fragment (e.g. `${id}`, `*`)
  // is dynamic but not a named parameter: its boundary must be reported, not guessed.
  const isDynamic = segment.includes('${') || segment === '*' || segment.includes('*');
  return { text: segment, isParameter: false, isDynamic };
}

/**
 * Normalizes framework path spelling while preserving every literal segment, so that
 * semantically different routes (different literal prefixes, different API versions)
 * never collapse onto the same normalized key. Case is preserved: frameworks differ on
 * case sensitivity and this shared layer must not assume one global behavior.
 */
export function normalizeRoutePath(rawPath: string): NormalizedRoutePath {
  // Query string / fragment are not part of the route path — never compared for matching.
  const pathOnly = rawPath.split(/[?#]/)[0]!.trim() || '/';
  const cleaned = pathOnly;
  const withoutTrailingSlash = cleaned.length > 1 && cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
  const parts = withoutTrailingSlash.split('/').filter((part) => part.length > 0);
  const segments = parts.map(parseSegment);
  const normalizedPath = segments.length === 0 ? '/' : '/' + segments.map((seg) => (seg.isParameter ? '{}' : seg.text)).join('/');
  const hasDynamicPrefix = segments.some((seg) => seg.isDynamic);
  return { normalizedPath, segments, hasDynamicPrefix };
}

export function composeRoutePrefix(prefix: string | undefined, path: string): string {
  const left = (prefix ?? '').trim().replace(/\/+$/, '');
  const trimmedPath = path.trim();
  const right = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
  const composed = `${left}${right}`.replace(/\/{2,}/g, '/');
  if (composed.length > 1 && composed.endsWith('/')) return composed.slice(0, -1);
  return composed || '/';
}

export function routeMatchKey(method: HttpMethodOrAny, normalizedPath: string): string {
  return `${method}:${normalizedPath}`;
}
