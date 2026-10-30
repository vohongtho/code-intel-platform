/**
 * taint/model-loader.ts
 *
 * Loads optional project taint models from the one canonical location,
 * `<repo>/.code-intel/taint-models.json`, and assembles the full registry
 * (built-ins + framework-adapter contributions + project models).
 *
 * Why this file and not the config hierarchy: Code Intel's only config
 * file is the user-global `~/.code-intel/config.json` (cli/init-wizard.ts),
 * whose schema (cli/config-manager.ts) is flat dot-path scalars/arrays
 * with no per-repository scope. Taint models are per-repository and
 * structured, so they live beside the other repo-scoped files
 * (`.code-intel/agent-targets.json`, `.code-intel/profile.json`). JSON,
 * not YAML, so no new parser dependency is needed.
 *
 * File shape: `{ "schemaVersion": 1, "models": [TaintModel, ...] }`.
 *
 * Safety: the path is fixed (never caller-controlled), its real path must
 * stay inside the repository (a symlink escaping the repo is rejected),
 * the file is size-capped before parsing, and model/matcher counts are
 * capped by the schema validator. An invalid project file is an error —
 * the loader never silently falls back to built-ins only, because a user
 * who wrote a model expects it to be applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TAINT_MODEL_LIMITS, type TaintModel, type TaintModelDiagnostic, type TaintModelLimits } from './model-schema.js';
import {
  builtinTaintModelSources,
  createTaintModelRegistry,
  frameworkContributionSources,
  type TaintModelRegistry,
  type TaintModelSource,
} from './model-registry.js';
import type { FrameworkTaintContribution } from '../../frameworks/contracts.js';

export const PROJECT_TAINT_MODELS_RELATIVE_PATH = '.code-intel/taint-models.json';
export const PROJECT_TAINT_MODELS_FILE_SCHEMA_VERSION = 1;

export type ProjectTaintModelStatus = 'absent' | 'loaded' | 'invalid';

export interface ProjectTaintModelLoadResult {
  status: ProjectTaintModelStatus;
  path: string;
  models: readonly TaintModel[];
  diagnostics: readonly TaintModelDiagnostic[];
}

function diagnostic(pathInFile: string, message: string): TaintModelDiagnostic {
  return { origin: PROJECT_TAINT_MODELS_RELATIVE_PATH, path: pathInFile, message };
}

function invalid(diagnostics: TaintModelDiagnostic[]): ProjectTaintModelLoadResult {
  return { status: 'invalid', path: PROJECT_TAINT_MODELS_RELATIVE_PATH, models: [], diagnostics };
}

/**
 * Reads and structurally checks the project model file. Individual model
 * validation happens in `createTaintModelRegistry`, so every diagnostic
 * (file-level and model-level) uses the same origin label.
 */
export function loadProjectTaintModels(repoDir: string, limits: TaintModelLimits = DEFAULT_TAINT_MODEL_LIMITS): ProjectTaintModelLoadResult {
  const repoRoot = path.resolve(repoDir);
  const filePath = path.join(repoRoot, PROJECT_TAINT_MODELS_RELATIVE_PATH);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    return { status: 'absent', path: PROJECT_TAINT_MODELS_RELATIVE_PATH, models: [], diagnostics: [] };
  }

  let realRoot: string;
  let realFile: string;
  try {
    realRoot = fs.realpathSync(repoRoot);
    realFile = fs.realpathSync(filePath);
  } catch (err) {
    return invalid([diagnostic('$', `could not resolve file path: ${err instanceof Error ? err.message : String(err)}`)]);
  }
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return invalid([diagnostic('$', 'resolves outside the repository (symlink escape); project taint models must live inside the repository')]);
  }
  const realStat = stat.isSymbolicLink() ? fs.statSync(realFile) : stat;
  if (!realStat.isFile()) return invalid([diagnostic('$', 'is not a regular file')]);
  if (realStat.size > limits.maxFileBytes) {
    return invalid([diagnostic('$', `is ${realStat.size} bytes; the maximum is ${limits.maxFileBytes}`)]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(realFile, 'utf8'));
  } catch (err) {
    return invalid([diagnostic('$', `is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)]);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid([diagnostic('$', 'must be an object')]);

  const file = parsed as Record<string, unknown>;
  const errors: TaintModelDiagnostic[] = [];
  for (const key of Object.keys(file).sort()) {
    if (key !== 'schemaVersion' && key !== 'models') errors.push(diagnostic(`$.${key}`, `unknown field '${key}'`));
  }
  if (file.schemaVersion !== PROJECT_TAINT_MODELS_FILE_SCHEMA_VERSION) {
    errors.push(diagnostic('$.schemaVersion', `is required and must be ${PROJECT_TAINT_MODELS_FILE_SCHEMA_VERSION}`));
  }
  if (!Array.isArray(file.models)) errors.push(diagnostic('$.models', 'is required and must be a list of models'));
  else if (file.models.length > limits.maxModels) errors.push(diagnostic('$.models', `declares ${file.models.length} models; the maximum is ${limits.maxModels}`));
  if (errors.length > 0) return invalid(errors);

  return { status: 'loaded', path: PROJECT_TAINT_MODELS_RELATIVE_PATH, models: file.models as TaintModel[], diagnostics: [] };
}

/** Taint fragments from every registered framework adapter, in adapter registration order. */
export async function collectFrameworkTaintContributions(): Promise<FrameworkTaintContribution[]> {
  const { loadFrameworkAdapters } = await import('../../frameworks/registry.js');
  const adapters = await loadFrameworkAdapters();
  return adapters.flatMap((adapter) => [...(adapter.taintModels?.() ?? [])]);
}

export interface LoadedTaintModelRegistry {
  registry?: TaintModelRegistry;
  projectModels: ProjectTaintModelLoadResult;
  diagnostics: readonly TaintModelDiagnostic[];
}

/**
 * Built-ins + framework contributions + the repository's project models.
 * `registry` is absent whenever anything is invalid; `diagnostics` then
 * says which file/model/matcher and why.
 */
export async function loadTaintModelRegistry(
  repoDir: string,
  options: { frameworkContributions?: readonly FrameworkTaintContribution[]; includeProjectModels?: boolean } = {},
): Promise<LoadedTaintModelRegistry> {
  const projectModels = options.includeProjectModels === false
    ? { status: 'absent' as const, path: PROJECT_TAINT_MODELS_RELATIVE_PATH, models: [], diagnostics: [] }
    : loadProjectTaintModels(repoDir);
  if (projectModels.status === 'invalid') return { projectModels, diagnostics: projectModels.diagnostics };

  const contributions = options.frameworkContributions ?? (await collectFrameworkTaintContributions());
  const sources: TaintModelSource[] = [
    ...builtinTaintModelSources(),
    ...frameworkContributionSources(contributions),
    ...projectModels.models.map((model) => ({ kind: 'project' as const, model, sourcePath: PROJECT_TAINT_MODELS_RELATIVE_PATH })),
  ];
  const result = createTaintModelRegistry(sources);
  if (!result.ok) return { projectModels: { ...projectModels, status: projectModels.status === 'loaded' ? 'invalid' : projectModels.status }, diagnostics: result.diagnostics };
  return { registry: result.registry, projectModels, diagnostics: [] };
}
