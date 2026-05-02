import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface DeprecatedFinding {
  symbol: string;
  filePath: string;
  deprecationMessage: string;
  callers: Array<{ name: string; filePath: string }>;
}

const BUILTIN_DEPRECATED: { pattern: string; message: string }[] = [
  { pattern: 'url.parse',          message: 'deprecated in Node.js v11.0.0 — use the WHATWG URL API instead' },
  { pattern: 'url.resolve',        message: 'deprecated in Node.js v11.0.0 — use the WHATWG URL API instead' },
  { pattern: 'url.format',         message: 'deprecated in Node.js v11.0.0 — use the WHATWG URL API instead' },
  { pattern: 'fs.exists',          message: 'deprecated — use fs.access instead' },
  { pattern: 'crypto.createCipher',  message: 'deprecated — use crypto.createCipheriv instead' },
  { pattern: 'crypto.createDecipher', message: 'deprecated — use crypto.createDecipheriv instead' },
  { pattern: 'new Buffer()',        message: 'deprecated — use Buffer.from() instead' },
  { pattern: 'domain.create',      message: 'deprecated — the domain module is discouraged' },
  { pattern: 'process.binding',    message: 'deprecated internal API' },
];

export class DeprecatedDetector {
  tagDeprecated(graph: KnowledgeGraph): void {
    for (const node of graph.allNodes()) {
      if (!node.metadata) node.metadata = {};

      // Already tagged
      if (node.metadata['deprecated'] === true) continue;

      let message: string | undefined;

      // 1. JSDoc / comment @deprecated
      const jsdoc = node.metadata['jsdoc'] as string | undefined;
      const comment = node.metadata['comment'] as string | undefined;
      if (jsdoc?.includes('@deprecated') || comment?.includes('@deprecated')) {
        const src = jsdoc ?? comment ?? '';
        const match = src.match(/@deprecated\s+(.*)/);
        message = match?.[1]?.trim() || 'deprecated';
      }

      // 2. metadata.deprecated flag
      if (!message && node.metadata['deprecated'] === true) {
        message = (node.metadata['deprecationMessage'] as string | undefined) ?? 'deprecated';
      }

      // 3. Java @Deprecated annotation
      if (!message) {
        const annotations = node.metadata['annotations'] as string[] | undefined;
        if (Array.isArray(annotations) && annotations.includes('Deprecated')) {
          message = 'marked @Deprecated';
        }
      }

      // 4. Rust #[deprecated] attribute
      if (!message) {
        const attributes = node.metadata['attributes'] as string[] | undefined;
        if (Array.isArray(attributes) && attributes.includes('deprecated')) {
          message = 'marked #[deprecated]';
        }
      }

      // 5. Built-in deprecated Node.js APIs
      if (!message) {
        for (const entry of BUILTIN_DEPRECATED) {
          if (node.name === entry.pattern || node.name.includes(entry.pattern)) {
            message = entry.message;
            break;
          }
        }
      }

      if (message) {
        node.metadata['deprecated'] = true;
        node.metadata['deprecationMessage'] = message;
      }
    }
  }

  detect(graph: KnowledgeGraph, scope?: string): DeprecatedFinding[] {
    const findings: DeprecatedFinding[] = [];

    for (const node of graph.allNodes()) {
      if (!node.metadata?.['deprecated']) continue;

      const callers: Array<{ name: string; filePath: string }> = [];

      for (const edge of graph.findEdgesTo(node.id)) {
        if (edge.kind !== 'calls' && edge.kind !== 'deprecated_use') continue;
        const caller = graph.getNode(edge.source);
        if (!caller) continue;
        if (scope && !caller.filePath.includes(scope)) continue;
        callers.push({ name: caller.name, filePath: caller.filePath });

        // Create deprecated_use edge if not already present
        const edgeId = `dep_use_${edge.source}_${node.id}`;
        if (!graph.getEdge(edgeId)) {
          graph.addEdge({ id: edgeId, source: edge.source, target: node.id, kind: 'deprecated_use' });
        }
      }

      findings.push({
        symbol: node.name,
        filePath: node.filePath,
        deprecationMessage: (node.metadata?.['deprecationMessage'] as string | undefined) ?? 'deprecated',
        callers,
      });
    }

    return findings;
  }
}
