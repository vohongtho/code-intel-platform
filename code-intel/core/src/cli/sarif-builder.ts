/**
 * sarif-builder.ts
 * Builds a SARIF 2.1.0 report from a PRImpactResult.
 * Extracted as a standalone module so it can be unit-tested without running
 * the full CLI process.
 */
import type { PRImpactResult } from '../query/pr-impact.js';
import type { StructuralCheckResult } from '../governance/structural-check.js';
import { STRUCTURAL_RULES } from '../governance/structural-check.js';

export interface SARIFRegion {
  startLine: number;
}

export interface SARIFArtifactLocation {
  uri: string;
}

export interface SARIFPhysicalLocation {
  artifactLocation: SARIFArtifactLocation;
  region: SARIFRegion;
}

export interface SARIFLocation {
  physicalLocation: SARIFPhysicalLocation;
}

export interface SARIFMessage {
  text: string;
}

export interface SARIFResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: SARIFMessage;
  locations: SARIFLocation[];
  /** Stable identity so code-scanning UIs track a finding across runs. */
  partialFingerprints?: Record<string, string>;
  properties?: Record<string, unknown>;
}

export interface SARIFShortDescription {
  text: string;
}

export interface SARIFRule {
  id: string;
  name: string;
  shortDescription: SARIFShortDescription;
  defaultConfiguration?: { level: 'error' | 'warning' | 'note' };
}

export interface SARIFDriver {
  name: string;
  version: string;
  rules: SARIFRule[];
}

export interface SARIFTool {
  driver: SARIFDriver;
}

export interface SARIFRun {
  tool: SARIFTool;
  results: SARIFResult[];
  properties?: Record<string, unknown>;
}

export interface SARIFReport {
  $schema: string;
  version: string;
  runs: SARIFRun[];
}

/**
 * Build a SARIF 2.1.0 report from a PRImpactResult.
 *
 * @param result - The PR impact result from computePRImpact()
 * @param version - The version string for the tool driver (from package.json)
 * @returns A fully-formed SARIF 2.1.0 report object
 */
export function buildSARIF(result: PRImpactResult, version: string): SARIFReport {
  const results: SARIFResult[] = [];

  for (const sym of result.changedSymbols) {
    if (sym.risk !== 'HIGH' && sym.risk !== 'MEDIUM') continue;

    const ruleId = sym.risk === 'HIGH' ? 'HIGH-RISK-SYMBOL' : 'MEDIUM-RISK-SYMBOL';
    const level: 'error' | 'warning' = sym.risk === 'HIGH' ? 'error' : 'warning';

    // Try to find the file for this symbol from the impacted/changed context
    // We use filesToReview as a fallback for location
    const uri = result.filesToReview[0] ?? 'unknown';

    results.push({
      ruleId,
      level,
      message: {
        text: `${sym.name} has blast radius of ${sym.callerCount} callers (${sym.risk} risk)`,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            region: { startLine: 1 },
          },
        },
      ],
    });
  }

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'code-intel',
            version,
            rules: [
              {
                id: 'HIGH-RISK-SYMBOL',
                name: 'HighRiskSymbol',
                shortDescription: { text: 'Symbol has high blast radius' },
              },
              {
                id: 'MEDIUM-RISK-SYMBOL',
                name: 'MediumRiskSymbol',
                shortDescription: { text: 'Symbol has medium blast radius' },
              },
            ],
          },
        },
        results,
      },
    ],
  };
}

const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json';

/**
 * Build a SARIF 2.1.0 report from a structural check. Output order follows the
 * (already deterministic) finding order; each result carries the finding id as
 * a partial fingerprint plus certainty/introduced/evidence properties, and the
 * run carries the check's coverage so a clean report with partial coverage is
 * not mistaken for proof of safety.
 */
export function buildStructuralSARIF(result: StructuralCheckResult, version: string): SARIFReport {
  const defaults: Record<string, 'error' | 'warning' | 'note'> = {
    'architecture/policy-invalid': 'error',
    'architecture/layer-violation': 'error',
    'graph/new-import-cycle': 'warning',
    'api/breaking-change': 'error',
    'risk/untested-change': 'warning',
    'refactor/verification-failed': 'error',
  };
  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'code-intel',
            version,
            rules: STRUCTURAL_RULES.map((rule) => ({
              id: rule.id,
              name: rule.name,
              shortDescription: { text: rule.description },
              defaultConfiguration: { level: defaults[rule.id] ?? 'warning' },
            })),
          },
        },
        results: result.findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: finding.severity,
          message: { text: `${finding.message}. ${finding.hint}` },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: finding.location.filePath },
              region: { startLine: Math.max(1, finding.location.startLine ?? 1) },
            },
          }],
          partialFingerprints: { 'codeIntelFindingId/v1': finding.id },
          properties: { certainty: finding.certainty, introduced: finding.introduced, evidence: finding.evidence },
        })),
        properties: {
          schemaVersion: result.schemaVersion,
          coverage: result.coverage,
          truncated: result.truncated,
          totalFindings: result.totalFindings,
          policy: result.policy,
        },
      },
    ],
  };
}
