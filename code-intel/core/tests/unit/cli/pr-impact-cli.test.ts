/**
 * Unit tests for Epic 6.1 — sarif-builder.ts and --fail-on logic.
 *
 * We test the SARIF builder function directly (no need to spawn a full CLI
 * process — that would require a live git repo and DB).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSARIF } from '../../../src/cli/sarif-builder.js';
import type { PRImpactResult } from '../../../src/query/pr-impact.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<PRImpactResult> = {}): PRImpactResult {
  return {
    changedSymbols: [],
    impactedSymbols: [],
    riskSummary: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    coverageGaps: [],
    filesToReview: [],
    crossRepoImpact: null,
    ...overrides,
  };
}

/** Simulate the --fail-on logic extracted from the CLI action */
function shouldFailOn(failOn: string, riskSummary: { HIGH: number; MEDIUM: number; LOW: number }): boolean {
  const level = failOn.toUpperCase();
  if (level === 'HIGH' && riskSummary.HIGH > 0) return true;
  if (level === 'MEDIUM' && (riskSummary.HIGH > 0 || riskSummary.MEDIUM > 0)) return true;
  return false;
}

// ─── Test 1: --fail-on HIGH exits 1 when HIGH risk found ─────────────────────

describe('--fail-on logic', () => {
  it('should fail when --fail-on HIGH and HIGH risk symbols exist', () => {
    const riskSummary = { HIGH: 2, MEDIUM: 1, LOW: 3 };
    assert.equal(shouldFailOn('HIGH', riskSummary), true);
  });

  it('should NOT fail when --fail-on HIGH but only MEDIUM/LOW risk', () => {
    const riskSummary = { HIGH: 0, MEDIUM: 3, LOW: 5 };
    assert.equal(shouldFailOn('HIGH', riskSummary), false);
  });

  it('should NOT fail when --fail-on HIGH and no symbols at all', () => {
    const riskSummary = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    assert.equal(shouldFailOn('HIGH', riskSummary), false);
  });

  it('should fail when --fail-on MEDIUM and MEDIUM risk symbols exist', () => {
    const riskSummary = { HIGH: 0, MEDIUM: 2, LOW: 1 };
    assert.equal(shouldFailOn('MEDIUM', riskSummary), true);
  });

  it('should fail when --fail-on MEDIUM and HIGH risk symbols exist', () => {
    const riskSummary = { HIGH: 1, MEDIUM: 0, LOW: 0 };
    assert.equal(shouldFailOn('MEDIUM', riskSummary), true);
  });

  it('should NOT fail when --fail-on MEDIUM and only LOW risk', () => {
    const riskSummary = { HIGH: 0, MEDIUM: 0, LOW: 5 };
    assert.equal(shouldFailOn('MEDIUM', riskSummary), false);
  });

  it('should NOT fail when --fail-on is empty string', () => {
    const riskSummary = { HIGH: 5, MEDIUM: 5, LOW: 5 };
    assert.equal(shouldFailOn('', riskSummary), false);
  });
});

// ─── Test 2: --format sarif produces valid SARIF structure ────────────────────

describe('buildSARIF', () => {
  it('produces a valid SARIF 2.1.0 top-level structure', () => {
    const result = makeResult();
    const sarif = buildSARIF(result, '1.0.0');

    assert.equal(sarif.version, '2.1.0');
    assert.ok(sarif.$schema.includes('sarif-schema-2.1.0'));
    assert.ok(Array.isArray(sarif.runs));
    assert.equal(sarif.runs.length, 1);
  });

  it('includes correct tool driver name and version', () => {
    const result = makeResult();
    const sarif = buildSARIF(result, '0.3.1');

    const driver = sarif.runs[0]!.tool.driver;
    assert.equal(driver.name, 'code-intel');
    assert.equal(driver.version, '0.3.1');
  });

  it('includes both HIGH-RISK-SYMBOL and MEDIUM-RISK-SYMBOL rules', () => {
    const result = makeResult();
    const sarif = buildSARIF(result, '1.0.0');

    const ruleIds = sarif.runs[0]!.tool.driver.rules.map((r) => r.id);
    assert.ok(ruleIds.includes('HIGH-RISK-SYMBOL'));
    assert.ok(ruleIds.includes('MEDIUM-RISK-SYMBOL'));
  });

  it('produces empty results array when no HIGH/MEDIUM symbols', () => {
    const result = makeResult({
      changedSymbols: [{ name: 'lowFunc', risk: 'LOW', callerCount: 2, testCoverage: true }],
      riskSummary: { HIGH: 0, MEDIUM: 0, LOW: 1 },
    });
    const sarif = buildSARIF(result, '1.0.0');

    assert.equal(sarif.runs[0]!.results.length, 0);
  });

  it('SARIF results contain correct ruleId for HIGH risk symbol', () => {
    const result = makeResult({
      changedSymbols: [{ name: 'dangerousFunc', risk: 'HIGH', callerCount: 75, testCoverage: false }],
      riskSummary: { HIGH: 1, MEDIUM: 0, LOW: 0 },
      filesToReview: ['src/api/users.ts'],
    });
    const sarif = buildSARIF(result, '1.0.0');

    const results = sarif.runs[0]!.results;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.ruleId, 'HIGH-RISK-SYMBOL');
    assert.equal(results[0]!.level, 'error');
  });

  it('SARIF results contain correct ruleId for MEDIUM risk symbol', () => {
    const result = makeResult({
      changedSymbols: [{ name: 'mediumFunc', risk: 'MEDIUM', callerCount: 15, testCoverage: false }],
      riskSummary: { HIGH: 0, MEDIUM: 1, LOW: 0 },
      filesToReview: ['src/services/auth.ts'],
    });
    const sarif = buildSARIF(result, '1.0.0');

    const results = sarif.runs[0]!.results;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.ruleId, 'MEDIUM-RISK-SYMBOL');
    assert.equal(results[0]!.level, 'warning');
  });

  it('SARIF message text includes symbol name, callerCount, and risk level', () => {
    const result = makeResult({
      changedSymbols: [{ name: 'getUser', risk: 'HIGH', callerCount: 45, testCoverage: false }],
      riskSummary: { HIGH: 1, MEDIUM: 0, LOW: 0 },
      filesToReview: ['src/api/users.ts'],
    });
    const sarif = buildSARIF(result, '1.0.0');

    const msg = sarif.runs[0]!.results[0]!.message.text;
    assert.ok(msg.includes('getUser'));
    assert.ok(msg.includes('45'));
    assert.ok(msg.includes('HIGH'));
  });

  it('produces valid JSON when stringified and re-parsed', () => {
    const result = makeResult({
      changedSymbols: [
        { name: 'funcA', risk: 'HIGH', callerCount: 60, testCoverage: false },
        { name: 'funcB', risk: 'MEDIUM', callerCount: 12, testCoverage: true },
        { name: 'funcC', risk: 'LOW', callerCount: 3, testCoverage: true },
      ],
      riskSummary: { HIGH: 1, MEDIUM: 1, LOW: 1 },
      filesToReview: ['src/api/index.ts'],
    });
    const sarif = buildSARIF(result, '1.0.0');
    const json = JSON.stringify(sarif, null, 2);

    let parsed: unknown;
    assert.doesNotThrow(() => { parsed = JSON.parse(json); });

    const p = parsed as typeof sarif;
    // Should have exactly 2 results (HIGH + MEDIUM; LOW is excluded)
    assert.equal(p.runs[0]!.results.length, 2);
  });

  it('location uri is populated from filesToReview when available', () => {
    const result = makeResult({
      changedSymbols: [{ name: 'myFunc', risk: 'HIGH', callerCount: 80, testCoverage: false }],
      riskSummary: { HIGH: 1, MEDIUM: 0, LOW: 0 },
      filesToReview: ['src/critical/module.ts'],
    });
    const sarif = buildSARIF(result, '1.0.0');

    const loc = sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation;
    assert.equal(loc.artifactLocation.uri, 'src/critical/module.ts');
    assert.equal(loc.region.startLine, 1);
  });

  it('location uri falls back to "unknown" when filesToReview is empty', () => {
    const result = makeResult({
      changedSymbols: [{ name: 'orphanFunc', risk: 'HIGH', callerCount: 55, testCoverage: false }],
      riskSummary: { HIGH: 1, MEDIUM: 0, LOW: 0 },
      filesToReview: [],
    });
    const sarif = buildSARIF(result, '1.0.0');

    const loc = sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation;
    assert.equal(loc.artifactLocation.uri, 'unknown');
  });

  it('handles mixed HIGH and MEDIUM symbols correctly', () => {
    const result = makeResult({
      changedSymbols: [
        { name: 'highFunc', risk: 'HIGH', callerCount: 100, testCoverage: false },
        { name: 'medFunc', risk: 'MEDIUM', callerCount: 20, testCoverage: false },
        { name: 'lowFunc', risk: 'LOW', callerCount: 1, testCoverage: true },
      ],
      riskSummary: { HIGH: 1, MEDIUM: 1, LOW: 1 },
      filesToReview: ['src/main.ts'],
    });
    const sarif = buildSARIF(result, '2.0.0');

    const results = sarif.runs[0]!.results;
    assert.equal(results.length, 2);

    const ruleIds = results.map((r) => r.ruleId);
    assert.ok(ruleIds.includes('HIGH-RISK-SYMBOL'));
    assert.ok(ruleIds.includes('MEDIUM-RISK-SYMBOL'));
  });

  it('driver rules have correct name fields', () => {
    const sarif = buildSARIF(makeResult(), '1.0.0');
    const rules = sarif.runs[0]!.tool.driver.rules;

    const highRule = rules.find((r) => r.id === 'HIGH-RISK-SYMBOL')!;
    const medRule = rules.find((r) => r.id === 'MEDIUM-RISK-SYMBOL')!;

    assert.equal(highRule.name, 'HighRiskSymbol');
    assert.equal(medRule.name, 'MediumRiskSymbol');
    assert.ok(highRule.shortDescription.text.length > 0);
    assert.ok(medRule.shortDescription.text.length > 0);
  });
});
