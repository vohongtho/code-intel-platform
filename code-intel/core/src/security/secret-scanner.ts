import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface SecretFinding {
  file: string;
  line?: number;
  symbol: string;
  pattern: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

// Patterns that indicate a value is an environment variable (safe)
const ENV_VAR_RE = /^process\.env\./;

// Name patterns for sensitive variables
const SENSITIVE_NAME_RE = /_SECRET$|_PASSWORD$|_TOKEN$|_KEY$|_API_KEY$/i;

// Value patterns → [pattern label, severity]
const VALUE_PATTERNS: [RegExp, string, SecretFinding['severity']][] = [
  [/sk-[A-Za-z0-9]{20,}/, 'openai-api-key', 'HIGH'],
  [/pk_live_[A-Za-z0-9]{20,}/, 'stripe-key', 'HIGH'],
  [/AKIA[0-9A-Z]{16}/, 'aws-access-key', 'HIGH'],
  [/xoxb-[0-9]{11}-[0-9]{11}-[A-Za-z0-9]{24}/, 'slack-token', 'HIGH'],
  [/postgres:\/\/[^@]+:[^@]+@/, 'db-url-with-credentials', 'HIGH'],
  [/mysql:\/\/[^@]+:[^@]+@/, 'db-url-with-credentials', 'HIGH'],
  [/-----BEGIN RSA PRIVATE KEY-----/, 'rsa-private-key', 'HIGH'],
];

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes('.test.') ||
    filePath.includes('.spec.') ||
    filePath.includes('fixtures/') ||
    filePath.includes('mocks/')
  );
}

export class SecretScanner {
  scan(
    graph: KnowledgeGraph,
    options?: { scope?: string; includeTestFiles?: boolean },
  ): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const includeTests = options?.includeTestFiles ?? false;
    const scope = options?.scope;

    for (const node of graph.allNodes()) {
      const filePath = node.filePath;

      // Scope filter
      if (scope && !filePath.startsWith(scope)) continue;

      // Test file filter
      if (!includeTests && isTestFile(filePath)) continue;

      const meta = node.metadata as Record<string, unknown> | undefined;
      const rawValue = (meta?.value ?? meta?.literalValue) as string | undefined;

      // ── Name-based check ─────────────────────────────────────────────────
      if (SENSITIVE_NAME_RE.test(node.name)) {
        if (
          typeof rawValue === 'string' &&
          rawValue.trim() !== '' &&
          !ENV_VAR_RE.test(rawValue.trim())
        ) {
          // Tag node
          node.metadata = {
            ...(node.metadata ?? {}),
            security: { secretRisk: true, secretPattern: 'sensitive-name-with-value' },
          };
          findings.push({
            file: filePath,
            line: node.startLine,
            symbol: node.name,
            pattern: 'sensitive-name-with-value',
            severity: 'MEDIUM',
          });
          continue;
        }
      }

      // ── Value-based checks ───────────────────────────────────────────────
      if (typeof rawValue !== 'string' || rawValue.trim() === '') continue;
      const value = rawValue.trim();
      if (ENV_VAR_RE.test(value)) continue;

      let matched = false;
      for (const [re, label, severity] of VALUE_PATTERNS) {
        if (re.test(value)) {
          node.metadata = {
            ...(node.metadata ?? {}),
            security: { secretRisk: true, secretPattern: label },
          };
          findings.push({
            file: filePath,
            line: node.startLine,
            symbol: node.name,
            pattern: label,
            severity,
          });
          matched = true;
          break;
        }
      }

      // ── High-entropy check ───────────────────────────────────────────────
      if (
        !matched &&
        SENSITIVE_NAME_RE.test(node.name) &&
        value.length > 20 &&
        shannonEntropy(value) > 4.5
      ) {
        node.metadata = {
          ...(node.metadata ?? {}),
          security: { secretRisk: true, secretPattern: 'high-entropy-string' },
        };
        findings.push({
          file: filePath,
          line: node.startLine,
          symbol: node.name,
          pattern: 'high-entropy-string',
          severity: 'MEDIUM',
        });
      }
    }

    return findings;
  }
}
