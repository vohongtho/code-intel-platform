import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

// Patterns that indicate a value is an environment variable (safe)
const ENV_VAR_RE = /^process\.env\./;

// Name patterns for sensitive variables
const SENSITIVE_NAME_RE = /_SECRET$|_PASSWORD$|_TOKEN$|_KEY$|_API_KEY$/i;
const COMMON_SENSITIVE_NAME_RE = /^(password|token|secret|apiKey|dbPassword)$/i;

// Value patterns → [pattern label, severity]
const VALUE_PATTERNS: [RegExp, string, string][] = [
  [/sk-[A-Za-z0-9]{6,}/, 'openai-api-key', 'HIGH'],
  [/pk_live_[A-Za-z0-9]{20,}/, 'stripe-key', 'HIGH'],
  [/AKIA[0-9A-Z]{16}|aws.access.key/i, 'aws-access-key', 'HIGH'],
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

const FILE_CONTENT_SECRET_RE = /["']?(password|token|secret|apiKey|dbPassword)["']?\s*(=>|:|=)\s*["']([^"'\n]{1,200})["']/gi;

export interface SecretFinding {
  file: string;
  line: number | undefined;
  symbol: string;
  pattern: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ScanOptions {
  includeTestFiles?: boolean;
  scope?: string;
  workspaceRoot?: string;
  ignorePatterns?: string[];
}

export class SecretScanner {
  scan(graph: KnowledgeGraph, options?: ScanOptions): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const includeTests = options?.includeTestFiles ?? false;
    const scope = options?.scope;

    // Load .codeintelignore patterns
    const ignorePatterns: string[] = [...(options?.ignorePatterns ?? [])];
    if (options?.workspaceRoot) {
      try {
        const raw = fs.readFileSync(path.join(options.workspaceRoot, '.codeintelignore'), 'utf-8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) ignorePatterns.push(trimmed);
        }
      } catch {
        // no .codeintelignore — that's fine
      }
    }

    for (const node of graph.allNodes()) {
      const filePath = node.filePath;

      // Scope filter
      if (scope && !filePath.startsWith(scope)) continue;

      // Test file filter
      if (!includeTests && isTestFile(filePath)) continue;

      // .codeintelignore pattern filter
      if (ignorePatterns.length > 0 && ignorePatterns.some(p => filePath.includes(p))) continue;

      const meta = node.metadata as Record<string, unknown> | undefined;
      const rawValue = (meta?.value ?? meta?.literalValue) as string | undefined;

      if (node.kind === 'file' && typeof node.content === 'string') {
        for (const match of node.content.matchAll(FILE_CONTENT_SECRET_RE)) {
          const secretName = match[1];
          const secretValue = match[3]?.trim();
          if (!secretName || !secretValue || ENV_VAR_RE.test(secretValue)) continue;
          const lineOffset = node.content.slice(0, match.index ?? 0).split('\n').length - 1;
          findings.push({
            file: filePath,
            line: lineOffset + 1,
            symbol: secretName,
            pattern: 'sensitive-name-with-value',
            severity: 'MEDIUM',
          });
        }
      }

      if (typeof rawValue !== 'string' || rawValue.trim() === '') continue;
      const value = rawValue.trim();
      if (ENV_VAR_RE.test(value)) continue;

      // ── Value-based checks first (most specific) ────────────────────────────
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
            severity: severity as 'HIGH' | 'MEDIUM',
          });
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // ── Name-based check ────────────────────────────────────────────────────
      const hasSensitiveName =
        SENSITIVE_NAME_RE.test(node.name) || COMMON_SENSITIVE_NAME_RE.test(node.name);
      if (hasSensitiveName) {
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

      // ── High-entropy check ──────────────────────────────────────────────────
      if (value.length > 20 && shannonEntropy(value) > 4.5) {
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
