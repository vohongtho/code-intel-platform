/**
 * sarif-builder.ts
 * Builds a SARIF 2.1.0 report from a PRImpactResult.
 * Extracted as a standalone module so it can be unit-tested without running
 * the full CLI process.
 */
import type { PRImpactResult } from '../query/pr-impact.js';

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
}

export interface SARIFShortDescription {
  text: string;
}

export interface SARIFRule {
  id: string;
  name: string;
  shortDescription: SARIFShortDescription;
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
