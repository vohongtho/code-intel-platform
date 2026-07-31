from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Expected block not found: {label}")
    return text.replace(old, new, 1)


app_path = ROOT / "code-intel/core/src/cli/app.ts"
app = app_path.read_text()
app = replace_once(
    app,
    "import { textSearch } from '../search/text-search.js';",
    "import { textSearch } from '../search/text-search.js';\nimport { resolveEmbeddingUpdatePlan } from '../search/embedding-update-plan.js';",
    "embedding plan import",
)
app = replace_once(
    app,
    "  let incrementalChangedFiles: string[] = [];\n  let incrementalDeletedFiles: string[] = [];\n  let scannedFilePaths: string[] = [];",
    "  let incrementalChangedFiles: string[] = [];\n  let incrementalDeletedFiles: string[] = [];\n  // Change detection is independent from graph execution mode. A correctness-first\n  // full graph rebuild must still allow vector updates for only changed/deleted files.\n  let detectedChangedFiles: string[] = [];\n  let detectedDeletedFiles: string[] = [];\n  let detectedChangeSetKnown = false;\n  let scannedFilePaths: string[] = [];",
    "change-set declarations",
)
app = replace_once(
    app,
    "      const decision = decideIncremental(\n        workspaceRoot,\n        scannedFilePaths,\n        prevMeta?.commitHash,\n        prevMeta?.lastAnalyzedMtimes,\n      );\n      if (decision.incremental) {",
    "      const decision = decideIncremental(\n        workspaceRoot,\n        scannedFilePaths,\n        prevMeta?.commitHash,\n        prevMeta?.lastAnalyzedMtimes,\n      );\n      // Preserve the detected change set even when graph analysis deliberately\n      // falls back to a clean full rebuild for cross-file correctness.\n      detectedChangedFiles = decision.changedExistingFiles ?? [];\n      detectedDeletedFiles = decision.deletedFiles ?? [];\n      detectedChangeSetKnown = true;\n      if (decision.incremental) {",
    "capture detected change set",
)
app = replace_once(
    app,
    "          incrementalChangedFiles = decision.changedExistingFiles ?? [];\n          incrementalDeletedFiles = decision.deletedFiles ?? [];",
    "          incrementalChangedFiles = detectedChangedFiles;\n          incrementalDeletedFiles = detectedDeletedFiles;",
    "reuse detected change set",
)
old_vector = """  // Vector embeddings (explicit or remembered per repo)
  const incrementalEmbeddingPaths = isIncremental && (incrementalChangedFiles.length > 0 || incrementalDeletedFiles.length > 0)
    ? [
      ...incrementalChangedFiles.map((f) => path.relative(workspaceRoot, f)),
      ...incrementalDeletedFiles,
    ]
    : null;
  const hasVectorDb = fs.existsSync(vectorDbPath);
  const embeddingsNeedRebuild = shouldRebuildEmbeddings({ metadata: previousMetadata, runtime: runtimeEmbeddingMetadata, hasVectorDb });
  const skipEmbeddingWork = embeddingMode.enabled
    && zeroChangeIncremental
    && hasVectorDb
    && !embeddingsNeedRebuild;
  const shouldForceFullEmbeddingRebuild = !skipEmbeddingWork
    && (!incrementalEmbeddingPaths || embeddingsNeedRebuild);
  const useIncrementalEmbeddings = Boolean(incrementalEmbeddingPaths && !shouldForceFullEmbeddingRebuild);
"""
new_vector = """  // Vector embeddings (explicit or remembered per repo)
  // IMPORTANT: vector update scope is based on the detected source change set,
  // not on whether graph execution is incremental or correctness-first full.
  const hasVectorDb = fs.existsSync(vectorDbPath);
  const embeddingsNeedRebuild = shouldRebuildEmbeddings({ metadata: previousMetadata, runtime: runtimeEmbeddingMetadata, hasVectorDb });
  const embeddingPlan = resolveEmbeddingUpdatePlan({
    enabled: embeddingMode.enabled,
    force: Boolean(options?.force),
    changeSetKnown: detectedChangeSetKnown,
    changedPaths: detectedChangedFiles.map((f) => path.relative(workspaceRoot, f)),
    deletedPaths: detectedDeletedFiles,
    hasVectorDb,
    embeddingsNeedRebuild,
  });
  const incrementalEmbeddingPaths = embeddingPlan.mode === 'incremental' ? embeddingPlan.paths : null;
  const skipEmbeddingWork = embeddingPlan.mode === 'skip';
  const useIncrementalEmbeddings = embeddingPlan.mode === 'incremental';
"""
app = replace_once(app, old_vector, new_vector, "vector update plan")
app_path.write_text(app)

(ROOT / "code-intel/core/src/search/embedding-update-plan.ts").write_text("""export type EmbeddingUpdatePlan =
  | { mode: 'skip'; reason: 'disabled' | 'no-changes' }
  | { mode: 'full'; reason: 'forced' | 'change-set-unknown' | 'vector-missing' | 'fingerprint-or-state-stale' }
  | { mode: 'incremental'; paths: string[] };

export interface ResolveEmbeddingUpdatePlanArgs {
  enabled: boolean;
  force: boolean;
  changeSetKnown: boolean;
  changedPaths: string[];
  deletedPaths: string[];
  hasVectorDb: boolean;
  embeddingsNeedRebuild: boolean;
}

/**
 * Resolve vector work independently from graph execution mode.
 * A graph may require a clean full rebuild for relationship correctness while
 * vectors can still delete/upsert only changed file paths.
 */
export function resolveEmbeddingUpdatePlan(args: ResolveEmbeddingUpdatePlanArgs): EmbeddingUpdatePlan {
  if (!args.enabled) return { mode: 'skip', reason: 'disabled' };
  if (args.force) return { mode: 'full', reason: 'forced' };
  if (!args.changeSetKnown) return { mode: 'full', reason: 'change-set-unknown' };
  if (!args.hasVectorDb) return { mode: 'full', reason: 'vector-missing' };
  if (args.embeddingsNeedRebuild) return { mode: 'full', reason: 'fingerprint-or-state-stale' };
  const paths = [...new Set([...args.changedPaths, ...args.deletedPaths])].filter(Boolean);
  if (paths.length === 0) return { mode: 'skip', reason: 'no-changes' };
  return { mode: 'incremental', paths };
}
""")

(ROOT / "code-intel/core/tests/unit/search/embedding-update-plan.test.ts").write_text("""import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmbeddingUpdatePlan } from '../../../src/search/embedding-update-plan.js';

const healthy = {
  enabled: true,
  force: false,
  changeSetKnown: true,
  changedPaths: [] as string[],
  deletedPaths: [] as string[],
  hasVectorDb: true,
  embeddingsNeedRebuild: false,
};

describe('resolveEmbeddingUpdatePlan', () => {
  it('builds full vectors on first use', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, hasVectorDb: false }), { mode: 'full', reason: 'vector-missing' });
  });
  it('updates only changed/deleted paths independently of graph mode', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, changedPaths: ['src/changed.ts'], deletedPaths: ['src/deleted.ts'] }), { mode: 'incremental', paths: ['src/changed.ts', 'src/deleted.ts'] });
  });
  it('deduplicates paths', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, changedPaths: ['src/a.ts'], deletedPaths: ['src/a.ts'] }), { mode: 'incremental', paths: ['src/a.ts'] });
  });
  it('skips known zero-change runs', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan(healthy), { mode: 'skip', reason: 'no-changes' });
  });
  it('fails safe to full rebuild when scope is unknown', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, changeSetKnown: false }), { mode: 'full', reason: 'change-set-unknown' });
  });
  it('full rebuilds stale/incompatible vectors', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, embeddingsNeedRebuild: true }), { mode: 'full', reason: 'fingerprint-or-state-stale' });
  });
  it('honors force', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, force: true, changedPaths: ['src/a.ts'] }), { mode: 'full', reason: 'forced' });
  });
  it('skips when embeddings are disabled', () => {
    assert.deepEqual(resolveEmbeddingUpdatePlan({ ...healthy, enabled: false }), { mode: 'skip', reason: 'disabled' });
  });
});
""")

integration_path = ROOT / "code-intel/core/tests/integration/cli/analyze-embeddings.test.ts"
integration = integration_path.read_text()
anchor = "  it('zero-change analyze with --embeddings preserves existing vector.db', () => {\n"
new_tests = """  it('rebuilds graph but updates vectors only for one changed file', () => {
    const repoDir = mkRepo('sticky-one-file-vector-update');
    runCli(repoDir, ['--embeddings']);
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), [
      'export function greet(name: string) {',
      '  return `incremental vector ${name}`;',
      '}',
      '',
      'export function welcome() {',
      '  return greet("one-file");',
      '}',
      '',
    ].join('\\n'));
    const out = runCli(repoDir, []);
    assert.match(out.stdout, /Falling back to full analysis: changes-detected/);
    assert.match(out.stdout, /Embeddings: \\d+ vectors updated incrementally/);
    assert.doesNotMatch(out.stdout, /Embeddings: \\d+ vectors built/);
    assert.equal(loadMetadata(repoDir)?.embeddings?.status, 'ready');
  });

  it('removes vectors only for one deleted file', () => {
    const repoDir = mkRepo('sticky-one-file-vector-delete');
    runCli(repoDir, ['--embeddings']);
    fs.rmSync(path.join(repoDir, 'src', 'extra-1.ts'));
    const out = runCli(repoDir, []);
    assert.match(out.stdout, /Embeddings: \\d+ vectors updated incrementally/);
    assert.doesNotMatch(out.stdout, /Embeddings: \\d+ vectors built/);
    assert.equal(loadMetadata(repoDir)?.embeddings?.status, 'ready');
  });

"""
integration = replace_once(integration, anchor, new_tests + anchor, "integration tests")
integration_path.write_text(integration)

spec_dir = ROOT / "openspec/changes/v1-0-9-fix-incremental-vector-rebuild"
spec_dir.mkdir(parents=True, exist_ok=True)
(spec_dir / ".openspec.yaml").write_text("schema: spec-driven\n")
(spec_dir / "proposal.md").write_text("""# v1.0.9: Decouple vector updates from graph rebuild mode

## Problem

v1.0.8 correctly performs a clean full graph rebuild when source files change, but incorrectly uses graph execution mode to decide vector scope. A one-file source change therefore rebuilds embeddings for the entire repository.

## Required behavior

- First embeddings-enabled analysis builds the full vector index.
- Known changed/deleted source sets update vectors only for those paths, even when graph analysis performs a correctness-first full rebuild.
- Known zero-change runs perform no vector writes.
- Missing/incompatible/stale vector state or explicit `--force` performs a full vector rebuild.
- Unknown change scope fails safe with a full vector rebuild.

## Non-goals

This does not restore partial graph rebuilding. Graph correctness and vector efficiency are independent decisions.
""")
(spec_dir / "tasks.md").write_text("""# Tasks

- [x] Capture changed/deleted files independently from graph execution mode.
- [x] Add a pure vector update planner.
- [x] Incrementally delete/upsert vectors after correctness-first graph rebuilds.
- [x] Preserve full rebuild for first run, force, stale fingerprint, missing DB, and unknown scope.
- [x] Add exhaustive planner unit tests.
- [x] Add CLI regressions for changed, deleted, and zero-change paths.
- [x] Bump package metadata and document v1.0.9.
""")

package_path = ROOT / "code-intel/core/package.json"
package = json.loads(package_path.read_text())
package["version"] = "1.0.9"
package_path.write_text(json.dumps(package, indent=2) + "\n")

lock_path = ROOT / "package-lock.json"
lock = json.loads(lock_path.read_text())
lock["packages"]["code-intel/core"]["version"] = "1.0.9"
lock_path.write_text(json.dumps(lock, indent=2) + "\n")

changelog_path = ROOT / "CHANGELOG.md"
changelog = changelog_path.read_text()
section = """## [1.0.9] - 2026-07-31

### 🧠 Incremental vector update correctness

- Decoupled vector update scope from graph execution mode.
- One-file source changes still use a correctness-first full graph rebuild, but now delete/upsert embeddings only for changed files.
- Deleted files remove only their own vectors; unchanged vectors are preserved.
- Zero-change runs preserve the vector database without writes.
- Full vector rebuilds are limited to first use, `--force`, missing vector storage, stale/incompatible metadata, or unknown change scope.
- Added exhaustive planner unit tests and CLI regression coverage.

---

"""
changelog = replace_once(changelog, "---\n\n## [1.0.8]", "---\n\n" + section + "## [1.0.8]", "changelog")
changelog_path.write_text(changelog)

(ROOT / "docs/releases/v1.0.9.md").write_text("""# Code Intel v1.0.9

## Incremental vector update fix

v1.0.9 separates source change detection from graph execution mode. Correctness-first graph rebuilds no longer imply full vector rebuilds.

| Situation | Graph | Vector |
| --- | --- | --- |
| First `analyze --embeddings` | Full | Full |
| Known changed files | Full correctness rebuild | Delete/upsert changed paths only |
| Deleted files | Full correctness rebuild | Delete deleted paths only |
| No changes | Fast path | No writes |
| `--force` | Full | Full |
| Missing/stale/incompatible vector state | As required | Full |
| Change scope unknown | Full | Full safe fallback |
""")
