import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { textSearch } from '../search/text-search.js';
import fs from 'node:fs';

export function createMcpServer(graph: KnowledgeGraph, repoName: string): Server {
  const server = new Server(
    { name: 'code-intel', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'repos',
        description: 'List indexed repositories',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'search',
        description: 'Hybrid search across the codebase knowledge graph',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'inspect',
        description: '360° view of a symbol: definition, callers, callees, heritage, references',
        inputSchema: {
          type: 'object' as const,
          properties: {
            symbol_name: { type: 'string', description: 'Symbol name to inspect' },
          },
          required: ['symbol_name'],
        },
      },
      {
        name: 'blast_radius',
        description: 'Impact analysis: what depends on / is affected by this symbol',
        inputSchema: {
          type: 'object' as const,
          properties: {
            target: { type: 'string', description: 'Target symbol name' },
            direction: { type: 'string', enum: ['callers', 'callees', 'both'], description: 'Direction to trace' },
            max_hops: { type: 'number', description: 'Max hops (default 5)' },
          },
          required: ['target'],
        },
      },
      {
        name: 'routes',
        description: 'List route handler mappings in the codebase',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'raw_query',
        description: 'Execute a graph query (simplified Cypher-like)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            cypher: { type: 'string', description: 'Query string (name=\'X\' or :kind patterns)' },
          },
          required: ['cypher'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    switch (name) {
      case 'repos': {
        return { content: [{ type: 'text', text: JSON.stringify([{ name: repoName, nodes: graph.size.nodes, edges: graph.size.edges }], null, 2) }] };
      }

      case 'search': {
        const query = a.query as string;
        const limit = (a.limit as number) ?? 20;
        const results = textSearch(graph, query, limit);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      case 'inspect': {
        const symbolName = a.symbol_name as string;
        const node = findNodeByName(graph, symbolName);
        if (!node) return { content: [{ type: 'text', text: `Symbol "${symbolName}" not found` }] };

        const incoming = [...graph.findEdgesTo(node.id)];
        const outgoing = [...graph.findEdgesFrom(node.id)];

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              node: { id: node.id, kind: node.kind, name: node.name, filePath: node.filePath, startLine: node.startLine, endLine: node.endLine, exported: node.exported },
              callers: incoming.filter((e) => e.kind === 'calls').map((e) => ({ id: e.source, name: graph.getNode(e.source)?.name })),
              callees: outgoing.filter((e) => e.kind === 'calls').map((e) => ({ id: e.target, name: graph.getNode(e.target)?.name })),
              extends: outgoing.filter((e) => e.kind === 'extends').map((e) => graph.getNode(e.target)?.name),
              implements: outgoing.filter((e) => e.kind === 'implements').map((e) => graph.getNode(e.target)?.name),
              members: outgoing.filter((e) => e.kind === 'has_member').map((e) => ({ name: graph.getNode(e.target)?.name, kind: graph.getNode(e.target)?.kind })),
              cluster: incoming.filter((e) => e.kind === 'belongs_to').map((e) => graph.getNode(e.target)?.name)[0],
              content: node.content?.slice(0, 500),
            }, null, 2),
          }],
        };
      }

      case 'blast_radius': {
        const target = a.target as string;
        const direction = (a.direction as string) ?? 'both';
        const maxHops = (a.max_hops as number) ?? 5;
        const node = findNodeByName(graph, target);
        if (!node) return { content: [{ type: 'text', text: `Symbol "${target}" not found` }] };

        const affected = new Set<string>();
        const queue: { id: string; depth: number }[] = [{ id: node.id, depth: 0 }];
        const visited = new Set<string>();

        while (queue.length > 0) {
          const { id, depth } = queue.shift()!;
          if (visited.has(id) || depth > maxHops) continue;
          visited.add(id);
          affected.add(id);

          if (direction === 'callers' || direction === 'both') {
            for (const edge of graph.findEdgesTo(id)) {
              if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.source, depth: depth + 1 });
            }
          }
          if (direction === 'callees' || direction === 'both') {
            for (const edge of graph.findEdgesFrom(id)) {
              if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.target, depth: depth + 1 });
            }
          }
        }

        const affectedDetails = [...affected].map((id) => {
          const n = graph.getNode(id);
          return n ? { id, name: n.name, kind: n.kind, filePath: n.filePath } : { id };
        });

        return { content: [{ type: 'text', text: JSON.stringify({ target: node.name, affectedCount: affected.size, affected: affectedDetails }, null, 2) }] };
      }

      case 'routes': {
        const routes: { name: string; filePath: string }[] = [];
        for (const node of graph.allNodes()) {
          if (node.kind === 'route' || (node.kind === 'function' && /route|handler|controller/i.test(node.filePath))) {
            routes.push({ name: node.name, filePath: node.filePath });
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(routes, null, 2) }] };
      }

      case 'raw_query': {
        const q = a.cypher as string;
        const nameMatch = q?.match(/name\s*=\s*['"]([^'"]+)['"]/i);
        if (nameMatch) {
          const results = [];
          for (const node of graph.allNodes()) {
            if (node.name === nameMatch[1]) results.push(node);
          }
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        const kindMatch = q?.match(/:\s*(\w+)/);
        if (kindMatch) {
          const results = [];
          for (const node of graph.allNodes()) {
            if (node.kind === kindMatch[1]) results.push(node);
            if (results.length >= 50) break;
          }
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        return { content: [{ type: 'text', text: 'Query not recognized' }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: `codeintel://repo/${repoName}/overview`, name: `${repoName} Overview`, mimeType: 'application/json' },
      { uri: `codeintel://repo/${repoName}/clusters`, name: `${repoName} Clusters`, mimeType: 'application/json' },
      { uri: `codeintel://repo/${repoName}/flows`, name: `${repoName} Flows`, mimeType: 'application/json' },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri.endsWith('/overview')) {
      const kindCounts: Record<string, number> = {};
      for (const node of graph.allNodes()) {
        kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;
      }
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ repo: repoName, stats: graph.size, nodeCounts: kindCounts }) }] };
    }

    if (uri.endsWith('/clusters')) {
      const clusters = [];
      for (const node of graph.allNodes()) {
        if (node.kind === 'cluster') clusters.push({ id: node.id, name: node.name, memberCount: node.metadata?.memberCount });
      }
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(clusters) }] };
    }

    if (uri.endsWith('/flows')) {
      const flows = [];
      for (const node of graph.allNodes()) {
        if (node.kind === 'flow') flows.push({ id: node.id, name: node.name, steps: node.metadata?.steps, entryPoint: node.metadata?.entryPoint });
      }
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(flows) }] };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

export async function startMcpStdio(graph: KnowledgeGraph, repoName: string): Promise<void> {
  const server = createMcpServer(graph, repoName);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function findNodeByName(graph: KnowledgeGraph, name: string) {
  for (const node of graph.allNodes()) {
    if (node.name === name) return node;
  }
  return undefined;
}
