/**
 * Explicit architecture policy: `<repo>/.code-intel/architecture-policy.json`.
 *
 * Same location convention and safety rules as the project taint models
 * (program-analysis/taint/model-loader.ts): fixed path, real path must stay
 * inside the repository, size-capped before parsing, unknown fields rejected,
 * JSON so no new parser dependency. An invalid file is an error, never a silent
 * "no policy" — a user who wrote rules expects them enforced.
 *
 * File shape:
 *   {
 *     "schemaVersion": 1,
 *     "layers": [{ "id": "domain", "include": ["src/domain/**"], "exclude": [] }],
 *     "rules":  [{ "from": "domain", "forbid": ["api"], "severity": "error" }]
 *   }
 *
 * Only these explicit layers/rules can produce structural-check violations;
 * inferred layers (analysis/architecture-layers.ts) never do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';

export const ARCHITECTURE_POLICY_RELATIVE_PATH = '.code-intel/architecture-policy.json';
export const ARCHITECTURE_POLICY_SCHEMA_VERSION = 1;
const MAX_POLICY_BYTES = 256 * 1024;
const MAX_LAYERS = 64;
const MAX_RULES = 256;
const MAX_PATTERNS = 64;
const LAYER_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export type FindingSeverity = 'error' | 'warning' | 'note';

export interface ArchitectureLayer {
  id: string;
  include: string[];
  exclude: string[];
}

export interface ArchitectureRule {
  from: string;
  forbid: string[];
  severity: FindingSeverity;
}

export interface ArchitecturePolicy {
  schemaVersion: typeof ARCHITECTURE_POLICY_SCHEMA_VERSION;
  layers: ArchitectureLayer[];
  rules: ArchitectureRule[];
}

export type ArchitecturePolicyLoad =
  | { status: 'absent'; path: string }
  | { status: 'loaded'; path: string; policy: ArchitecturePolicy }
  | { status: 'invalid'; path: string; errors: string[] };

function stringList(value: unknown, at: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 512)) {
    errors.push(`${at} must be a list of non-empty strings`);
    return [];
  }
  if (value.length > MAX_PATTERNS) errors.push(`${at} has ${value.length} entries; the maximum is ${MAX_PATTERNS}`);
  return value as string[];
}

function unknownKeys(raw: Record<string, unknown>, allowed: string[], at: string, errors: string[]): void {
  for (const key of Object.keys(raw).sort()) if (!allowed.includes(key)) errors.push(`${at}.${key} is not a known field`);
}

/** Validate an already-parsed policy document. */
export function validateArchitecturePolicy(parsed: unknown): { policy?: ArchitecturePolicy; errors: string[] } {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { errors: ['$ must be an object'] };
  const raw = parsed as Record<string, unknown>;
  unknownKeys(raw, ['schemaVersion', 'layers', 'rules'], '$', errors);
  if (raw['schemaVersion'] !== ARCHITECTURE_POLICY_SCHEMA_VERSION) errors.push(`$.schemaVersion must be ${ARCHITECTURE_POLICY_SCHEMA_VERSION}`);
  const rawLayers = raw['layers'];
  const rawRules = raw['rules'] ?? [];
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) errors.push('$.layers must be a non-empty list');
  if (!Array.isArray(rawRules)) errors.push('$.rules must be a list');
  if (errors.length > 0) return { errors };

  const layers: ArchitectureLayer[] = [];
  const ids = new Set<string>();
  (rawLayers as unknown[]).slice(0, MAX_LAYERS).forEach((entry, i) => {
    const at = `$.layers[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const layer = entry as Record<string, unknown>;
    unknownKeys(layer, ['id', 'include', 'exclude'], at, errors);
    const id = layer['id'];
    if (typeof id !== 'string' || !LAYER_ID.test(id)) errors.push(`${at}.id must match ${LAYER_ID}`);
    else if (ids.has(id)) errors.push(`${at}.id '${id}' is duplicated`);
    else ids.add(id);
    const include = stringList(layer['include'], `${at}.include`, errors);
    if (include.length === 0) errors.push(`${at}.include must list at least one glob`);
    layers.push({ id: String(id), include, exclude: stringList(layer['exclude'], `${at}.exclude`, errors) });
  });
  if ((rawLayers as unknown[]).length > MAX_LAYERS) errors.push(`$.layers has more than ${MAX_LAYERS} entries`);

  const rules: ArchitectureRule[] = [];
  (rawRules as unknown[]).slice(0, MAX_RULES).forEach((entry, i) => {
    const at = `$.rules[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const rule = entry as Record<string, unknown>;
    unknownKeys(rule, ['from', 'forbid', 'severity'], at, errors);
    const from = rule['from'];
    if (typeof from !== 'string' || !ids.has(from)) errors.push(`${at}.from must name a declared layer`);
    const forbid = stringList(rule['forbid'], `${at}.forbid`, errors);
    if (forbid.length === 0) errors.push(`${at}.forbid must name at least one layer`);
    for (const target of forbid) if (!ids.has(target)) errors.push(`${at}.forbid names unknown layer '${target}'`);
    const severity = rule['severity'] ?? 'error';
    if (severity !== 'error' && severity !== 'warning' && severity !== 'note') errors.push(`${at}.severity must be error, warning or note`);
    rules.push({ from: String(from), forbid, severity: severity as FindingSeverity });
  });
  if ((rawRules as unknown[]).length > MAX_RULES) errors.push(`$.rules has more than ${MAX_RULES} entries`);

  return errors.length > 0 ? { errors } : { policy: { schemaVersion: ARCHITECTURE_POLICY_SCHEMA_VERSION, layers, rules }, errors };
}

export function loadArchitecturePolicy(repoDir: string): ArchitecturePolicyLoad {
  const root = path.resolve(repoDir);
  const filePath = path.join(root, ARCHITECTURE_POLICY_RELATIVE_PATH);
  const rel = ARCHITECTURE_POLICY_RELATIVE_PATH;
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return { status: 'absent', path: rel };
  }
  let realFile: string;
  try {
    realFile = fs.realpathSync(filePath);
    const relative = path.relative(fs.realpathSync(root), realFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return { status: 'invalid', path: rel, errors: ['resolves outside the repository (symlink escape)'] };
  } catch (error) {
    return { status: 'invalid', path: rel, errors: [`could not resolve path: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const realStat = stat.isSymbolicLink() ? fs.statSync(realFile) : stat;
  if (!realStat.isFile()) return { status: 'invalid', path: rel, errors: ['is not a regular file'] };
  if (realStat.size > MAX_POLICY_BYTES) return { status: 'invalid', path: rel, errors: [`is ${realStat.size} bytes; the maximum is ${MAX_POLICY_BYTES}`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(realFile, 'utf8'));
  } catch (error) {
    return { status: 'invalid', path: rel, errors: [`is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const { policy, errors } = validateArchitecturePolicy(parsed);
  return policy ? { status: 'loaded', path: rel, policy } : { status: 'invalid', path: rel, errors };
}

/** The explicit layer a file belongs to (first matching layer in declaration order), or null. */
export function layerOf(policy: ArchitecturePolicy, filePath: string): string | null {
  for (const layer of policy.layers) {
    if (layer.include.some((glob) => minimatch(filePath, glob, { dot: true }))
      && !layer.exclude.some((glob) => minimatch(filePath, glob, { dot: true }))) return layer.id;
  }
  return null;
}
