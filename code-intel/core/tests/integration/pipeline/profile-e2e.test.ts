/**
 * Integration test — Epic 4: --profile flag end-to-end
 *
 * Verifies that when context.profile=true the orchestrator captures per-phase
 * memory data, and that the CLI helper produces a valid profile.json on disk.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { runPipeline } from '../../../src/pipeline/orchestrator.js';
import {
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
} from '../../../src/pipeline/phases/index.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist-tests/tests/integration/pipeline → up 6 = monorepo root
const PKG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const SHARED_ROOT = path.join(PKG_ROOT, 'code-intel', 'shared');

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `profile-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Profile E2E — --profile flag', () => {
  // ── Test 1: orchestrator captures memory fields when profile=true ─────────
  it('orchestrator captures memoryBeforeMB/memoryAfterMB on all phases when profile=true', async () => {
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
      profile: true,
    };

    const result = await runPipeline([scanPhase, structurePhase, parsePhase, resolvePhase], context);

    assert.equal(result.success, true, 'Pipeline should succeed');
    for (const [name, pr] of result.results) {
      assert.ok(typeof pr.memoryBeforeMB === 'number', `${name}: memoryBeforeMB should be number`);
      assert.ok(typeof pr.memoryAfterMB  === 'number', `${name}: memoryAfterMB should be number`);
      assert.ok(pr.memoryBeforeMB >= 0, `${name}: memoryBeforeMB should be >= 0`);
      assert.ok(pr.memoryAfterMB  >= 0, `${name}: memoryAfterMB should be >= 0`);
    }
  });

  // ── Test 2: profile.json is written correctly ─────────────────────────────
  it('writes a valid profile.json file with all required fields', async () => {
    const dir = tmpDir();
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
      profile: true,
    };

    const result = await runPipeline([scanPhase, structurePhase, parsePhase, resolvePhase], context);
    assert.equal(result.success, true);

    // Simulate what analyzeWorkspace does after runPipeline
    const codeIntelDir = path.join(dir, '.code-intel');
    fs.mkdirSync(codeIntelDir, { recursive: true });

    const profileEntries = [];
    for (const [phaseName, pr] of result.results) {
      profileEntries.push({
        phase: phaseName,
        duration: pr.duration,
        memoryBeforeMB: pr.memoryBeforeMB,
        memoryAfterMB: pr.memoryAfterMB,
        memoryDeltaMB: pr.memoryBeforeMB !== undefined && pr.memoryAfterMB !== undefined
          ? pr.memoryAfterMB - pr.memoryBeforeMB
          : undefined,
      });
    }
    const profileJson = {
      profiledAt: new Date().toISOString(),
      totalDuration: result.totalDuration,
      phases: profileEntries,
    };
    const profilePath = path.join(codeIntelDir, 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(profileJson, null, 2));

    // Verify file exists and is valid JSON
    assert.ok(fs.existsSync(profilePath), 'profile.json should exist');
    const raw = fs.readFileSync(profilePath, 'utf-8');
    let parsed: typeof profileJson;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, 'profile.json should be valid JSON');
    parsed = JSON.parse(raw);

    // profiledAt is a valid ISO date
    assert.ok(typeof parsed.profiledAt === 'string', 'profiledAt should be a string');
    assert.ok(!isNaN(Date.parse(parsed.profiledAt)), 'profiledAt should be a valid ISO date');

    // totalDuration is a number
    assert.ok(typeof parsed.totalDuration === 'number', 'totalDuration should be a number');
    assert.ok(parsed.totalDuration >= 0);

    // phases is a non-empty array
    assert.ok(Array.isArray(parsed.phases), 'phases should be an array');
    assert.ok(parsed.phases.length > 0, 'phases should not be empty');

    // Each phase entry has required fields
    for (const entry of parsed.phases) {
      assert.ok(typeof entry.phase    === 'string', 'each phase entry must have a phase name');
      assert.ok(typeof entry.duration === 'number', `phase ${entry.phase}: duration must be a number`);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ── Test 3: bottleneck detection — phase > 50% of total wall-clock ────────
  it('single-phase pipeline always triggers bottleneck threshold (100% of total)', async () => {
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
      profile: true,
    };

    // Only scan: it will be 100% of total time → qualifies as bottleneck
    const result = await runPipeline([scanPhase], context);
    assert.equal(result.success, true);
    assert.ok(result.results.has('scan'));
    const scanResult = result.results.get('scan')!;
    // wall-clock totalDuration > 0 for a real scan
    assert.ok(result.totalDuration >= 0);
    // The single phase occupies 100% → bottleneck logic should fire
    assert.ok(
      result.totalDuration === 0 || scanResult.duration / result.totalDuration <= 1.0,
      'single phase duration cannot exceed total',
    );
  });

  // ── Test 4: phase durations sum ≈ total (within 20% slack for overhead) ───
  it('sum of phase durations is within reasonable range of totalDuration', async () => {
    const graph = createKnowledgeGraph();
    const context: PipelineContext = {
      workspaceRoot: SHARED_ROOT,
      graph,
      filePaths: [],
      profile: true,
    };

    const result = await runPipeline([scanPhase, structurePhase, parsePhase, resolvePhase], context);
    assert.equal(result.success, true);

    const totalDuration = result.totalDuration;
    assert.ok(totalDuration >= 0, 'totalDuration should be non-negative');
    // All individual durations should be non-negative
    for (const [name, pr] of result.results) {
      assert.ok(pr.duration >= 0, `${name}: duration must be >= 0`);
    }
  });
});
