/**
 * Advisory architecture-layer discovery.
 *
 * Suggests layers from directory names, import direction between directories,
 * and existing cluster membership. Suggestions carry confidence and evidence
 * and can be copied into `.code-intel/architecture-policy.json`, but they are
 * never enforced: only an explicit policy (governance/policy-schema.ts) can
 * produce a structural-check violation.
 */
import path from 'node:path';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export type LayerRole = 'presentation' | 'api' | 'application' | 'domain' | 'infrastructure' | 'shared' | 'test';

export interface LayerEvidence {
  kind: 'path-pattern' | 'import-direction' | 'cluster';
  detail: string;
}

export interface LayerSuggestion {
  id: string;
  role: LayerRole;
  include: string[];
  fileCount: number;
  confidence: number;
  evidence: LayerEvidence[];
  advisory: true;
}

export interface ArchitectureLayerReport {
  advisory: true;
  suggestions: LayerSuggestion[];
  /** Directory-level import counts the suggestions were derived from. */
  dependencies: Array<{ from: string; to: string; imports: number }>;
  note: string;
}

const ROLE_PATTERNS: Array<[LayerRole, RegExp]> = [
  ['test', /^(tests?|__tests__|spec|specs|e2e)$/],
  ['presentation', /^(ui|components?|pages|views?|screens|web|frontend|client)$/],
  ['api', /^(api|apis|routes?|controllers?|handlers?|http|rest|graphql|grpc|endpoints?|mcp-server)$/],
  ['application', /^(app|application|use-?cases?|commands?|cli|workflows?|jobs?)$/],
  ['domain', /^(domain|core|models?|entities|services?|business|logic)$/],
  ['infrastructure', /^(infra|infrastructure|storage|db|database|persistence|repositor(y|ies)|adapters?|clients?|gateways?|integrations?)$/],
  ['shared', /^(shared|common|utils?|lib|libs|helpers?|support)$/],
];

/** Typical dependency direction: lower rank should not import higher rank. */
const ROLE_RANK: Record<LayerRole, number> = { test: 6, presentation: 5, api: 4, application: 3, domain: 2, infrastructure: 1, shared: 0 };

function layerDirectory(filePath: string): string | null {
  const parts = filePath.split('/');
  if (parts.length < 2) return null;
  // Group under the first directory below a conventional source root.
  const srcIndex = parts.findIndex((part) => part === 'src' || part === 'lib' || part === 'app');
  if (srcIndex >= 0 && parts.length > srcIndex + 2) return parts.slice(0, srcIndex + 2).join('/');
  return parts.slice(0, Math.min(parts.length - 1, 2)).join('/');
}

export function detectArchitectureLayers(graph: KnowledgeGraph): ArchitectureLayerReport {
  const filesByDir = new Map<string, Set<string>>();
  for (const node of graph.allNodes()) {
    if (node.kind !== 'file') continue;
    const dir = layerDirectory(node.filePath);
    if (!dir) continue;
    let files = filesByDir.get(dir);
    if (!files) filesByDir.set(dir, (files = new Set()));
    files.add(node.filePath);
  }

  const deps = new Map<string, number>();
  for (const edge of graph.findEdgesByKind('imports')) {
    const from = graph.getNode(edge.source)?.filePath;
    const to = graph.getNode(edge.target)?.filePath;
    if (!from || !to) continue;
    const a = layerDirectory(from);
    const b = layerDirectory(to);
    if (!a || !b || a === b) continue;
    const key = `${a}\u0000${b}`;
    deps.set(key, (deps.get(key) ?? 0) + 1);
  }
  const dependencies = [...deps].map(([key, imports]) => {
    const [from, to] = key.split('\u0000');
    return { from, to, imports };
  }).sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));

  const clusterByFile = new Map<string, string>();
  for (const edge of graph.findEdgesByKind('belongs_to')) {
    const member = graph.getNode(edge.source);
    const cluster = graph.getNode(edge.target);
    if (member && cluster?.kind === 'cluster' && !clusterByFile.has(member.filePath)) clusterByFile.set(member.filePath, cluster.name);
  }

  const suggestions: LayerSuggestion[] = [];
  for (const [dir, files] of [...filesByDir].sort(([a], [b]) => a.localeCompare(b))) {
    const leaf = path.posix.basename(dir).toLowerCase();
    const role = ROLE_PATTERNS.find(([, pattern]) => pattern.test(leaf))?.[0];
    if (!role) continue;
    const evidence: LayerEvidence[] = [{ kind: 'path-pattern', detail: `directory '${leaf}' conventionally holds the ${role} layer` }];
    let confidence = 0.5;

    const outgoing = dependencies.filter((d) => d.from === dir);
    const incoming = dependencies.filter((d) => d.to === dir);
    const consistent = outgoing.filter((d) => {
      const otherRole = ROLE_PATTERNS.find(([, pattern]) => pattern.test(path.posix.basename(d.to).toLowerCase()))?.[0];
      return otherRole !== undefined && ROLE_RANK[otherRole] <= ROLE_RANK[role];
    }).length;
    if (outgoing.length + incoming.length > 0) {
      evidence.push({ kind: 'import-direction', detail: `${outgoing.length} outgoing / ${incoming.length} incoming directory dependencies; ${consistent} outgoing point to same-or-lower layers` });
      if (outgoing.length > 0) confidence += 0.3 * (consistent / outgoing.length);
    }
    const clusters = new Set([...files].map((file) => clusterByFile.get(file)).filter(Boolean));
    if (clusters.size === 1) {
      evidence.push({ kind: 'cluster', detail: `all files share cluster '${[...clusters][0]}'` });
      confidence += 0.1;
    }
    suggestions.push({
      id: `${role}:${dir}`,
      role,
      include: [`${dir}/**`],
      fileCount: files.size,
      confidence: Math.round(Math.min(confidence, 0.95) * 100) / 100,
      evidence,
      advisory: true,
    });
  }

  return {
    advisory: true,
    suggestions,
    dependencies,
    note: 'Suggestions are advisory and never fail a check. Copy confirmed layers into .code-intel/architecture-policy.json to enforce rules.',
  };
}
