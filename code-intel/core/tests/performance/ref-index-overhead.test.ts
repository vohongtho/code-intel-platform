/**
 * Ref-aware and portable index benchmarks (v1.0.12 tasks 19–20).
 *
 * 19. Cached-ref vs current-generation read overhead. Both sides serve the *same*
 *     artifacts (the current index is a copy of the ref's snapshot), so the
 *     measured difference is purely view resolution + pinning, not data size.
 *     The first ref query builds the snapshot and is excluded; afterwards a
 *     cached ref must never materialize/analyze again.
 * 20. Export/import scaling by artifact bytes. The package layer (hash, archive,
 *     bounded extraction, hash verification) is measured directly with
 *     incompressible synthetic artifacts at three sizes, plus one end-to-end
 *     export→import of a real snapshot for absolute numbers.
 *
 * Ceilings are deliberately generous (shared CI hardware); they catch an
 * accidental per-request rebuild or super-linear packaging, not small drift.
 * Measured numbers are logged as `[bench] …` lines.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { dispatchTool, resetRepoGraphCacheForTests } from '../../src/mcp-server/server.js';
import { createKnowledgeGraph } from '../../src/graph/knowledge-graph.js';
import { resolveReadIndexView, resetIndexViewMemoForTests } from '../../src/storage/index-view-resolver.js';
import { exportPortableIndex, importPortableIndex } from '../../src/snapshots/export-import.js';
import {
  DEFAULT_PORTABLE_LIMITS,
  extractPortablePackage,
  serializeManifest,
  writePortableArchive,
  type PortableIndexManifestV1,
} from '../../src/snapshots/portable-format.js';
import { buildSnapshotDescriptor, computeAnalyzerFingerprints } from '../../src/snapshots/fingerprint.js';
import { SNAPSHOT_SCHEMA_VERSION } from '../../src/snapshots/types.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-index-bench-'));
const REPO = path.join(TMP, 'repo');
const ORIGIN = 'https://example.com/org/bench.git';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

before(() => {
  fs.mkdirSync(REPO, { recursive: true });
  git(['init', '--quiet'], REPO);
  git(['config', 'user.email', 'bench@example.com'], REPO);
  git(['config', 'user.name', 'Bench'], REPO);
  git(['remote', 'add', 'origin', ORIGIN], REPO);
  fs.writeFileSync(path.join(REPO, '.gitignore'), '.code-intel/\n');
  // ~1.6k symbols across 80 modules with cross-module calls.
  for (let m = 0; m < 80; m += 1) {
    const lines: string[] = [];
    if (m > 0) lines.push(`import { svc${m - 1}_0 } from './mod${m - 1}.js';`);
    for (let f = 0; f < 20; f += 1) {
      const call = m > 0 && f === 0 ? `svc${m - 1}_0()` : f > 0 ? `svc${m}_${f - 1}()` : '0';
      lines.push(`export function svc${m}_${f}(): number {\n  const value${f} = ${f};\n  return value${f} + Number(${call});\n}`);
    }
    fs.writeFileSync(path.join(REPO, `mod${m}.ts`), `${lines.join('\n')}\n`);
  }
  git(['add', '.'], REPO);
  git(['commit', '--quiet', '-m', 'bench'], REPO);
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('ref read overhead (task 19)', { timeout: 600_000 }, () => {
  it('a cached ref is served without rebuilding and with overhead comparable to the current index', async () => {
    const first = await resolveReadIndexView({ repoDir: REPO, ref: 'HEAD' });
    assert.ok(first.ok, !first.ok ? first.boundary.message : '');
    assert.equal(first.view.resolution, 'built');
    // Make the current index a byte-identical copy of the snapshot so both paths read the same data.
    const current = path.join(REPO, '.code-intel');
    for (const name of ['graph.db', 'bm25.db', 'meta.json']) fs.copyFileSync(path.join(first.view.artifactsDir, name), path.join(current, name));
    first.view.release();

    // View resolution alone (fresh process memo once, then memoized).
    resetIndexViewMemoForTests();
    const resolveTimes: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const start = process.hrtime.bigint();
      const r = await resolveReadIndexView({ repoDir: REPO, ref: 'HEAD', allowBuild: false });
      resolveTimes.push(ms(start));
      assert.ok(r.ok);
      assert.equal(r.view.resolution, 'cached', 'a cached ref must never rebuild');
      r.view.release();
    }
    const coldResolve = resolveTimes[0]!;
    const warmResolve = median(resolveTimes.slice(1));

    // Full tool calls, warm caches on both sides.
    resetRepoGraphCacheForTests();
    const graph = createKnowledgeGraph();
    const run = async (args: Record<string, unknown>) => {
      const start = process.hrtime.bigint();
      const res = await dispatchTool('search', args, graph, 'bench', REPO);
      const elapsed = ms(start);
      assert.notEqual(res.isError, true, res.content[0]?.text);
      return elapsed;
    };
    await run({ query: 'svc40_3' });
    await run({ query: 'svc40_3', ref: 'HEAD' });
    const currentTimes: number[] = [];
    const refTimes: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const q = `svc${i * 3}_${i % 20}`;
      currentTimes.push(await run({ query: q }));
      refTimes.push(await run({ query: q, ref: 'HEAD' }));
    }
    const currentMedian = median(currentTimes);
    const refMedian = median(refTimes);
    console.log(`[bench] ref view resolve: cold=${coldResolve.toFixed(1)}ms warm-median=${warmResolve.toFixed(1)}ms`);
    console.log(`[bench] search median: current=${currentMedian.toFixed(1)}ms ref=${refMedian.toFixed(1)}ms overhead=${(refMedian - currentMedian).toFixed(1)}ms`);

    assert.ok(warmResolve < 250, `warm cached-ref resolution took ${warmResolve}ms`);
    assert.ok(refMedian <= currentMedian * 3 + 150, `ref search ${refMedian}ms vs current ${currentMedian}ms`);
  });
});

describe('portable export/import scaling (task 20)', { timeout: 600_000 }, () => {
  function syntheticManifest(artifacts: { name: 'graph.db' | 'meta.json'; size: number; sha256: string }[]): PortableIndexManifestV1 {
    const descriptor = { ...buildSnapshotDescriptor({ repositoryIdentity: ORIGIN, gitTree: 'a'.repeat(40), commit: 'b'.repeat(40) }), createdAt: new Date(0).toISOString() };
    return {
      format: 'code-intel-portable-index',
      formatVersion: 1,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      descriptor,
      repositoryIdentity: ORIGIN,
      producer: { codeIntelVersion: 'bench', analyzer: computeAnalyzerFingerprints() },
      privacyProfile: 'full',
      capabilities: { privacyProfile: 'full', sourceContent: true, bm25: false, bm25Content: 'none', vector: false, evidence: false, protocolContracts: false },
      artifacts: artifacts.map((a) => ({ ...a, required: true })),
    };
  }

  it('package write and verified extraction scale linearly with artifact bytes', async () => {
    const rows: { mib: number; writeMs: number; readMs: number }[] = [];
    for (const mib of [4, 16, 64]) {
      const dir = fs.mkdtempSync(path.join(TMP, `scale-${mib}-`));
      const graphPath = path.join(dir, 'graph.db');
      const metaPath = path.join(dir, 'meta.json');
      // Incompressible: random bytes, so gzip cannot hide the payload size.
      const fd = fs.openSync(graphPath, 'w');
      for (let i = 0; i < mib; i += 1) fs.writeSync(fd, crypto.randomBytes(1024 * 1024));
      fs.closeSync(fd);
      fs.writeFileSync(metaPath, '{}');
      const hash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      const manifest = syntheticManifest([
        { name: 'graph.db', size: fs.statSync(graphPath).size, sha256: hash(graphPath) },
        { name: 'meta.json', size: 2, sha256: hash(metaPath) },
      ]);
      const manifestBytes = serializeManifest(manifest);
      const pkg = path.join(dir, 'p.cidx');

      let start = process.hrtime.bigint();
      await writePortableArchive(pkg, [
        { name: 'manifest.json', data: manifestBytes, size: manifestBytes.length },
        { name: 'graph.db', filePath: graphPath, size: manifest.artifacts[0]!.size },
        { name: 'meta.json', filePath: metaPath, size: 2 },
      ]);
      const writeMs = ms(start);

      const staging = path.join(dir, 'staging');
      fs.mkdirSync(staging);
      start = process.hrtime.bigint();
      const { extracted } = await extractPortablePackage(pkg, staging, DEFAULT_PORTABLE_LIMITS);
      const readMs = ms(start);
      assert.deepEqual(extracted.sort(), ['graph.db', 'meta.json']);
      rows.push({ mib, writeMs, readMs });
      fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const row of rows) {
      console.log(`[bench] package ${String(row.mib).padStart(3)} MiB: write=${row.writeMs.toFixed(0)}ms (${(row.mib / (row.writeMs / 1000)).toFixed(0)} MiB/s) verify+extract=${row.readMs.toFixed(0)}ms (${(row.mib / (row.readMs / 1000)).toFixed(0)} MiB/s)`);
    }
    // Linear: per-MiB cost at 64 MiB stays within 2.5x of the 16 MiB per-MiB cost.
    const perMib = (row: (typeof rows)[number]) => (row.writeMs + row.readMs) / row.mib;
    assert.ok(perMib(rows[2]!) <= perMib(rows[1]!) * 2.5 + 5, `super-linear packaging: ${JSON.stringify(rows)}`);
  });

  it('end-to-end export → import of a real snapshot', async () => {
    const out = path.join(TMP, 'bench.cidx');
    let start = process.hrtime.bigint();
    const exported = await exportPortableIndex({ repoDir: REPO, ref: 'HEAD', outputPath: out });
    const exportMs = ms(start);
    assert.equal(exported.status, 'exported', JSON.stringify(exported));
    if (exported.status !== 'exported') return;
    const payload = exported.manifest.artifacts.reduce((sum, a) => sum + a.size, 0);

    const clone = path.join(TMP, 'clone');
    git(['clone', '--quiet', REPO, clone], TMP);
    git(['remote', 'set-url', 'origin', ORIGIN], clone);
    start = process.hrtime.bigint();
    const imported = await importPortableIndex({ repoDir: clone, packagePath: out });
    const importMs = ms(start);
    assert.equal(imported.status, 'imported', JSON.stringify(imported));
    console.log(`[bench] e2e: artifacts=${(payload / 1024 / 1024).toFixed(1)} MiB package=${(exported.packageBytes / 1024 / 1024).toFixed(1)} MiB export=${exportMs.toFixed(0)}ms import(validate+readback+publish)=${importMs.toFixed(0)}ms`);
  });
});
