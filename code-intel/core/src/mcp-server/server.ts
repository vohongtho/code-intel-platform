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
import { loadRegistry } from '../storage/repo-registry.js';
import { loadMetadata } from '../storage/metadata.js';
import {
  listGroups,
  loadGroup,
  saveGroup,
  loadSyncResult,
  saveSyncResult,
} from '../multi-repo/group-registry.js';
import { syncGroup } from '../multi-repo/group-sync.js';
import { queryGroup } from '../multi-repo/group-query.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { withSpan, isTracingEnabled, sanitizeAttrs } from '../observability/tracing.js';
import { mcpToolCallsTotal, mcpToolDurationSeconds } from '../observability/metrics.js';

export function createMcpServer(graph: KnowledgeGraph, repoName: string, workspaceRoot?: string): Server {
  const server = new Server(
    { name: 'code-intel', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ─── Tool Definitions ──────────────────────────────────────────────────────

  // ── Shared _token property injected into every tool schema ─────────────────
  const _tokenProp = {
    _token: { type: 'string' as const, description: 'Required if CODE_INTEL_TOKEN is configured' },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // ── Core repo tools ──────────────────────────────────────────────────
      {
        name: 'repos',
        description: 'List all indexed repositories with node and edge counts',
        inputSchema: { type: 'object' as const, properties: { ..._tokenProp } },
      },
      {
        name: 'overview',
        description: 'Repository summary: total nodes/edges and a full breakdown of node and edge counts by kind. Use this first to understand the shape of the codebase.',
        inputSchema: { type: 'object' as const, properties: { ..._tokenProp } },
      },

      // ── Search & inspect ─────────────────────────────────────────────────
      {
        name: 'search',
        description: 'BM25 keyword search across all indexed symbols — functions, classes, files, routes, etc.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query (symbol name, keyword, or partial match)' },
            limit: { type: 'number', description: 'Max results to return (default: 20)' },
            ..._tokenProp,
          },
          required: ['query'],
        },
      },
      {
        name: 'inspect',
        description: '360° view of a symbol: definition location, callers, callees, heritage (extends/implements), members, cluster, and source preview (first 500 chars)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            symbol_name: { type: 'string', description: 'Exact symbol name to inspect' },
            ..._tokenProp,
          },
          required: ['symbol_name'],
        },
      },
      {
        name: 'blast_radius',
        description: 'Impact analysis: traverse the call/import graph to find all symbols that depend on or are affected by a given symbol. Returns risk level (LOW / MEDIUM / HIGH).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            target: { type: 'string', description: 'Target symbol name' },
            direction: {
              type: 'string',
              enum: ['callers', 'callees', 'both'],
              description: 'Which direction to trace — callers (who depends on it), callees (what it depends on), or both (default: both)',
            },
            max_hops: { type: 'number', description: 'Maximum traversal depth (default: 5)' },
            ..._tokenProp,
          },
          required: ['target'],
        },
      },
      {
        name: 'file_symbols',
        description: 'List all symbols defined in a specific file — useful to understand what a file exports or contains without reading raw source.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            file_path: { type: 'string', description: 'File path (partial match is supported, e.g. "auth/login.ts")' },
            ..._tokenProp,
          },
          required: ['file_path'],
        },
      },
      {
        name: 'find_path',
        description: 'Find the shortest call/import path between two symbols. Useful for tracing how one module reaches another.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from: { type: 'string', description: 'Source symbol name' },
            to: { type: 'string', description: 'Target symbol name' },
            max_hops: { type: 'number', description: 'Maximum path length to search (default: 8)' },
            ..._tokenProp,
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'list_exports',
        description: 'List all exported symbols in the repository. Helps AI understand the public API surface of the codebase.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            kind: {
              type: 'string',
              description: 'Filter by node kind: function | class | interface | method | type_alias | constant | enum (optional)',
            },
            limit: { type: 'number', description: 'Max results (default: 100)' },
            ..._tokenProp,
          },
        },
      },

      // ── Routes, clusters, flows ──────────────────────────────────────────
      {
        name: 'routes',
        description: 'List all HTTP route handler mappings detected in the codebase (kind=route or route/handler/controller files)',
        inputSchema: { type: 'object' as const, properties: { ..._tokenProp } },
      },
      {
        name: 'clusters',
        description: 'List detected code clusters (directory-based communities) with member counts and top 10 symbols each. Useful for understanding code organisation.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Max clusters to return (default: 50)' },
            ..._tokenProp,
          },
        },
      },
      {
        name: 'flows',
        description: 'List all detected execution flows — entry points traced through the call graph. Each flow has a name, entry point, and ordered steps.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Max flows to return (default: 50)' },
            ..._tokenProp,
          },
        },
      },

      // ── Git change impact ─────────────────────────────────────────────────
      {
        name: 'detect_changes',
        description: 'Git-diff impact analysis: detects which source files and line ranges changed (HEAD vs working tree or a custom diff), maps them to graph symbols, and computes the combined blast radius. Ideal for PR review or pre-commit analysis.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            base_ref: {
              type: 'string',
              description: 'Git ref to diff against (default: HEAD). Examples: "HEAD~1", "main", a commit SHA.',
            },
            diff_text: {
              type: 'string',
              description: 'Raw unified diff text. If provided, base_ref is ignored and this diff is parsed directly.',
            },
            ..._tokenProp,
          },
        },
      },

      // ── Raw query ─────────────────────────────────────────────────────────
      {
        name: 'raw_query',
        description: 'Execute a simplified Cypher-like graph query. Supports: name=\'X\' (exact name match) or :kind (list nodes of a kind, max 50)',
        inputSchema: {
          type: 'object' as const,
          properties: {
            cypher: { type: 'string', description: "Query string — e.g. name='runPipeline' or :function" },
            ..._tokenProp,
          },
          required: ['cypher'],
        },
      },

      // ── Group / multi-repo tools ──────────────────────────────────────────
      {
        name: 'group_list',
        description: 'List all configured repository groups, or show the full membership of one group. Repository groups track multiple repos as a logical system.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Group name to inspect (optional — omit to list all groups)' },
            ..._tokenProp,
          },
        },
      },
      {
        name: 'group_sync',
        description: 'Extract cross-repo contracts (exports, routes, schemas, events) from every member repo in a group and detect provider→consumer links via name matching and RRF scoring.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Group name to sync' },
            ..._tokenProp,
          },
          required: ['name'],
        },
      },
      {
        name: 'group_contracts',
        description: 'Inspect extracted contracts and confidence-ranked cross-repo links from the last group sync. Supports filtering by kind, repo, and minimum confidence.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Group name' },
            kind: {
              type: 'string',
              enum: ['export', 'route', 'schema', 'event'],
              description: 'Filter by contract kind (optional)',
            },
            repo: { type: 'string', description: 'Filter by registry name (optional)' },
            min_confidence: { type: 'number', description: 'Minimum link confidence 0–1 (default: 0)' },
            ..._tokenProp,
          },
          required: ['name'],
        },
      },
      {
        name: 'group_query',
        description: 'BM25 search across all repos in a group, merged via Reciprocal Rank Fusion (RRF). Returns a unified ranked list plus per-repo breakdown.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Group name' },
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results per repo (default: 10)' },
            ..._tokenProp,
          },
          required: ['name', 'query'],
        },
      },
      {
        name: 'group_status',
        description: 'Check index freshness and sync staleness for all repos in a group. Flags repos that have not been indexed or are stale (>24h).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Group name' },
            ..._tokenProp,
          },
          required: ['name'],
        },
      },
    ],
  }));

  // ─── Tool Handlers ─────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    // ── Token authentication ───────────────────────────────────────────────
    const expectedToken = process.env['CODE_INTEL_TOKEN'];
    if (expectedToken) {
      const providedToken = a._token;
      if (providedToken !== expectedToken) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Unauthorized: invalid or missing CODE_INTEL_TOKEN' }) }],
          isError: true,
        };
      }
    }

    // ── OTel span + Prometheus metrics wrapper ─────────────────────────────
    const startMs = Date.now();
    const dispatch = () => dispatchTool(name, a, graph, repoName, workspaceRoot);

    let result: Awaited<ReturnType<typeof dispatchTool>>;
    let status = 'success';
    try {
      if (isTracingEnabled()) {
        result = await withSpan(
          `mcp.tool.${name}`,
          sanitizeAttrs({ 'mcp.tool': name, 'mcp.repo': repoName }),
          dispatch,
        );
      } else {
        result = await dispatch();
      }
      if (result.isError) status = 'error';
    } catch (err) {
      status = 'error';
      mcpToolCallsTotal.inc({ tool: name, status });
      mcpToolDurationSeconds.observe({ tool: name }, (Date.now() - startMs) / 1000);
      throw err;
    }
    mcpToolCallsTotal.inc({ tool: name, status });
    mcpToolDurationSeconds.observe({ tool: name }, (Date.now() - startMs) / 1000);
    return result;
  });

  // ─── Resources ───────────────────────────────────────────────────────────────
  registerResources(server, graph, repoName);

  return server;
}
// ─── Tool dispatch (extracted for testability + OTel wrapping) ───────────────

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };

async function dispatchTool(
  name: string,
  a: Record<string, unknown>,
  graph: KnowledgeGraph,
  repoName: string,
  workspaceRoot: string | undefined,
): Promise<ToolResult> {
  switch (name) {

      // ── repos ──────────────────────────────────────────────────────────────
      case 'repos': {
        const registry = loadRegistry();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              registry.map((r) => ({ name: r.name, path: r.path, indexedAt: r.indexedAt, stats: r.stats })),
              null, 2,
            ),
          }],
        };
      }

      // ── overview ───────────────────────────────────────────────────────────
      case 'overview': {
        const kindCounts: Record<string, number> = {};
        for (const node of graph.allNodes()) {
          kindCounts[node.kind] = (kindCounts[node.kind] ?? 0) + 1;
        }
        const edgeCounts: Record<string, number> = {};
        for (const edge of graph.allEdges()) {
          edgeCounts[edge.kind] = (edgeCounts[edge.kind] ?? 0) + 1;
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              repo: repoName,
              stats: graph.size,
              nodeCounts: kindCounts,
              edgeCounts,
            }, null, 2),
          }],
        };
      }

      // ── search ─────────────────────────────────────────────────────────────
      case 'search': {
        const query = a.query as string;
        const limit = (a.limit as number) ?? 20;
        const results = textSearch(graph, query, limit);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      // ── inspect ────────────────────────────────────────────────────────────
      case 'inspect': {
        const symbolName = a.symbol_name as string;
        const node = findNodeByName(graph, symbolName);
        if (!node) return { content: [{ type: 'text', text: `Symbol "${symbolName}" not found. Try search first.` }] };

        const incoming = [...graph.findEdgesTo(node.id)];
        const outgoing = [...graph.findEdgesFrom(node.id)];

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              node: {
                id: node.id,
                kind: node.kind,
                name: node.name,
                filePath: node.filePath,
                startLine: node.startLine,
                endLine: node.endLine,
                exported: node.exported,
              },
              callers: incoming.filter((e) => e.kind === 'calls').map((e) => ({
                id: e.source, name: graph.getNode(e.source)?.name, file: graph.getNode(e.source)?.filePath,
              })),
              callees: outgoing.filter((e) => e.kind === 'calls').map((e) => ({
                id: e.target, name: graph.getNode(e.target)?.name, file: graph.getNode(e.target)?.filePath,
              })),
              imports: incoming.filter((e) => e.kind === 'imports').map((e) => graph.getNode(e.source)?.name),
              importedBy: outgoing.filter((e) => e.kind === 'imports').map((e) => graph.getNode(e.target)?.name),
              extends: outgoing.filter((e) => e.kind === 'extends').map((e) => graph.getNode(e.target)?.name),
              implements: outgoing.filter((e) => e.kind === 'implements').map((e) => graph.getNode(e.target)?.name),
              members: outgoing.filter((e) => e.kind === 'has_member').map((e) => ({
                name: graph.getNode(e.target)?.name, kind: graph.getNode(e.target)?.kind,
              })),
              cluster: incoming.filter((e) => e.kind === 'belongs_to').map((e) => graph.getNode(e.target)?.name)[0],
              content: node.content?.slice(0, 500),
            }, null, 2),
          }],
        };
      }

      // ── blast_radius ───────────────────────────────────────────────────────
      case 'blast_radius': {
        const target = a.target as string;
        const direction = (a.direction as string) ?? 'both';
        const maxHops = (a.max_hops as number) ?? 5;
        const node = findNodeByName(graph, target);
        if (!node) return { content: [{ type: 'text', text: `Symbol "${target}" not found.` }] };

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

        const risk = affected.size > 10 ? 'HIGH' : affected.size > 5 ? 'MEDIUM' : 'LOW';

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              target: node.name,
              affectedCount: affected.size,
              riskLevel: risk,
              affected: affectedDetails,
            }, null, 2),
          }],
        };
      }

      // ── file_symbols ───────────────────────────────────────────────────────
      case 'file_symbols': {
        const filePath = a.file_path as string;
        const matches: { kind: string; name: string; startLine: number | undefined; exported: boolean | undefined }[] = [];
        for (const node of graph.allNodes()) {
          if (node.filePath && node.filePath.includes(filePath)) {
            matches.push({ kind: node.kind, name: node.name, startLine: node.startLine, exported: node.exported });
          }
        }
        if (matches.length === 0) {
          return { content: [{ type: 'text', text: `No symbols found for file path matching "${filePath}".` }] };
        }
        matches.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0));
        return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
      }

      // ── find_path ──────────────────────────────────────────────────────────
      case 'find_path': {
        const fromName = a.from as string;
        const toName = a.to as string;
        const maxHops = (a.max_hops as number) ?? 8;

        const fromNode = findNodeByName(graph, fromName);
        const toNode = findNodeByName(graph, toName);

        if (!fromNode) return { content: [{ type: 'text', text: `Source symbol "${fromName}" not found.` }] };
        if (!toNode) return { content: [{ type: 'text', text: `Target symbol "${toName}" not found.` }] };

        // BFS for shortest path
        type PathNode = { id: string; path: string[] };
        const queue: PathNode[] = [{ id: fromNode.id, path: [fromNode.id] }];
        const visited = new Set<string>();

        let foundPath: string[] | null = null;
        while (queue.length > 0) {
          const { id, path: currentPath } = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);

          if (id === toNode.id) { foundPath = currentPath; break; }
          if (currentPath.length > maxHops) continue;

          for (const edge of graph.findEdgesFrom(id)) {
            if ((edge.kind === 'calls' || edge.kind === 'imports') && !visited.has(edge.target)) {
              queue.push({ id: edge.target, path: [...currentPath, edge.target] });
            }
          }
        }

        if (!foundPath) {
          return { content: [{ type: 'text', text: `No path found from "${fromName}" to "${toName}" within ${maxHops} hops.` }] };
        }

        const pathDetails = foundPath.map((id) => {
          const n = graph.getNode(id);
          return n ? { id, name: n.name, kind: n.kind, filePath: n.filePath } : { id };
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ from: fromName, to: toName, hops: foundPath.length - 1, path: pathDetails }, null, 2),
          }],
        };
      }

      // ── list_exports ───────────────────────────────────────────────────────
      case 'list_exports': {
        const kindFilter = a.kind as string | undefined;
        const limit = (a.limit as number) ?? 100;
        const exports: { kind: string; name: string; filePath: string; startLine: number | undefined }[] = [];

        for (const node of graph.allNodes()) {
          if (!node.exported) continue;
          if (kindFilter && node.kind !== kindFilter) continue;
          exports.push({ kind: node.kind, name: node.name, filePath: node.filePath, startLine: node.startLine });
          if (exports.length >= limit) break;
        }

        return { content: [{ type: 'text', text: JSON.stringify({ total: exports.length, exports }, null, 2) }] };
      }

      // ── routes ─────────────────────────────────────────────────────────────
      case 'routes': {
        const routes: { name: string; filePath: string; startLine: number | undefined }[] = [];
        for (const node of graph.allNodes()) {
          if (node.kind === 'route' || (node.kind === 'function' && /route|handler|controller/i.test(node.filePath))) {
            routes.push({ name: node.name, filePath: node.filePath, startLine: node.startLine });
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(routes, null, 2) }] };
      }

      // ── clusters ───────────────────────────────────────────────────────────
      case 'clusters': {
        const limit = (a.limit as number) ?? 50;
        const clusters: {
          id: string;
          name: string;
          memberCount: number;
          topSymbols: { name: string; kind: string }[];
        }[] = [];

        for (const node of graph.allNodes()) {
          if (node.kind === 'cluster') {
            const members: { name: string; kind: string }[] = [];
            for (const edge of graph.findEdgesTo(node.id)) {
              if (edge.kind === 'belongs_to') {
                const member = graph.getNode(edge.source);
                if (member && member.kind !== 'cluster') {
                  members.push({ name: member.name, kind: member.kind });
                }
              }
            }
            clusters.push({
              id: node.id,
              name: node.name,
              memberCount: (node.metadata?.memberCount as number | undefined) ?? members.length,
              topSymbols: members.slice(0, 10),
            });
            if (clusters.length >= limit) break;
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(clusters, null, 2) }] };
      }

      // ── flows ──────────────────────────────────────────────────────────────
      case 'flows': {
        const limit = (a.limit as number) ?? 50;
        const flows: {
          id: string;
          name: string;
          entryPoint: string | undefined;
          steps: unknown;
          stepCount: number;
        }[] = [];

        for (const node of graph.allNodes()) {
          if (node.kind === 'flow') {
            const steps = node.metadata?.steps as unknown[] | undefined;
            flows.push({
              id: node.id,
              name: node.name,
              entryPoint: node.metadata?.entryPoint as string | undefined,
              steps: steps ?? [],
              stepCount: Array.isArray(steps) ? steps.length : 0,
            });
            if (flows.length >= limit) break;
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(flows, null, 2) }] };
      }

      // ── detect_changes ─────────────────────────────────────────────────────
      case 'detect_changes': {
        const baseRef = (a.base_ref as string) ?? 'HEAD';
        const diffTextInput = a.diff_text as string | undefined;

        let diffText: string;
        const repoRoot = workspaceRoot ?? process.cwd();

        if (diffTextInput) {
          diffText = diffTextInput;
        } else {
          try {
            diffText = execSync(`git diff ${baseRef}`, { cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
            if (!diffText.trim()) {
              // Fall back to staged + unstaged
              diffText = execSync(`git diff HEAD`, { cwd: repoRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
            }
          } catch {
            return { content: [{ type: 'text', text: `Could not run git diff in ${repoRoot}. Ensure the path is a Git repository.` }] };
          }
        }

        if (!diffText.trim()) {
          return { content: [{ type: 'text', text: 'No changes detected in git diff.' }] };
        }

        // Parse unified diff → { filePath, changedLines: number[] }
        const changedFiles = parseDiff(diffText);

        // Map changed lines to graph nodes
        const hitNodes = new Set<string>();
        for (const { filePath: changedFile, changedLines } of changedFiles) {
          for (const node of graph.allNodes()) {
            if (!node.filePath) continue;
            // Normalize path comparison (strip repo root prefix)
            const normNode = node.filePath.replace(repoRoot + '/', '').replace(repoRoot + path.sep, '');
            const normChanged = changedFile.replace(/^a\/|^b\//, '');
            if (!normNode.endsWith(normChanged) && !normChanged.endsWith(normNode)) continue;

            if (node.startLine !== undefined && node.endLine !== undefined) {
              const overlaps = changedLines.some((l) => l >= node.startLine! && l <= node.endLine!);
              if (overlaps) hitNodes.add(node.id);
            } else if (node.startLine !== undefined) {
              const overlaps = changedLines.some((l) => Math.abs(l - node.startLine!) <= 3);
              if (overlaps) hitNodes.add(node.id);
            }
          }
        }

        // Compute combined blast radius from all hit nodes
        const allAffected = new Set<string>();
        for (const startId of hitNodes) {
          const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
          const visited = new Set<string>();
          while (queue.length > 0) {
            const { id, depth } = queue.shift()!;
            if (visited.has(id) || depth > 5) continue;
            visited.add(id);
            allAffected.add(id);
            for (const edge of graph.findEdgesTo(id)) {
              if (edge.kind === 'calls' || edge.kind === 'imports') queue.push({ id: edge.source, depth: depth + 1 });
            }
          }
        }

        const changedSymbols = [...hitNodes].map((id) => {
          const n = graph.getNode(id);
          return n ? { id, name: n.name, kind: n.kind, filePath: n.filePath } : { id };
        });

        const affectedSymbols = [...allAffected]
          .filter((id) => !hitNodes.has(id))
          .map((id) => {
            const n = graph.getNode(id);
            return n ? { id, name: n.name, kind: n.kind, filePath: n.filePath } : { id };
          });

        const risk = allAffected.size > 10 ? 'HIGH' : allAffected.size > 4 ? 'MEDIUM' : 'LOW';

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              baseRef,
              changedFiles: changedFiles.map((f) => f.filePath),
              directlyChangedSymbols: changedSymbols,
              transitivelyAffectedSymbols: affectedSymbols,
              totalAffected: allAffected.size,
              riskLevel: risk,
            }, null, 2),
          }],
        };
      }

      // ── raw_query ──────────────────────────────────────────────────────────
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
        return { content: [{ type: 'text', text: 'Query not recognized. Use name=\'X\' or :kind syntax.' }] };
      }

      // ── group_list ─────────────────────────────────────────────────────────
      case 'group_list': {
        const groupName = a.name as string | undefined;
        if (groupName) {
          const group = loadGroup(groupName);
          if (!group) return { content: [{ type: 'text', text: `Group "${groupName}" not found.` }] };
          return { content: [{ type: 'text', text: JSON.stringify(group, null, 2) }] };
        }
        const groups = listGroups();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              groups.map((g) => ({ name: g.name, createdAt: g.createdAt, lastSync: g.lastSync, memberCount: g.members.length, members: g.members })),
              null, 2,
            ),
          }],
        };
      }

      // ── group_sync ─────────────────────────────────────────────────────────
      case 'group_sync': {
        const groupName = a.name as string;
        const group = loadGroup(groupName);
        if (!group) return { content: [{ type: 'text', text: `Group "${groupName}" not found.` }] };
        if (group.members.length === 0) return { content: [{ type: 'text', text: `Group "${groupName}" has no members.` }] };

        const result = await syncGroup(group);
        saveSyncResult(result);
        group.lastSync = result.syncedAt;
        saveGroup(group);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              groupName: result.groupName,
              syncedAt: result.syncedAt,
              memberCount: result.memberCount,
              contractCount: result.contracts.length,
              linkCount: result.links.length,
              topLinks: result.links.slice(0, 20),
            }, null, 2),
          }],
        };
      }

      // ── group_contracts ────────────────────────────────────────────────────
      case 'group_contracts': {
        const groupName = a.name as string;
        const kindFilter = a.kind as string | undefined;
        const repoFilter = a.repo as string | undefined;
        const minConf = (a.min_confidence as number) ?? 0;

        const result = loadSyncResult(groupName);
        if (!result) return { content: [{ type: 'text', text: `No sync data for group "${groupName}". Run group_sync first.` }] };

        let contracts = result.contracts;
        if (kindFilter) contracts = contracts.filter((c) => c.kind === kindFilter);
        if (repoFilter) contracts = contracts.filter((c) => c.repoName === repoFilter);

        let links = result.links.filter((l) => l.confidence >= minConf);
        if (repoFilter) links = links.filter((l) => l.providerRepo === repoFilter || l.consumerRepo === repoFilter);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ syncedAt: result.syncedAt, contracts, links }, null, 2),
          }],
        };
      }

      // ── group_query ────────────────────────────────────────────────────────
      case 'group_query': {
        const groupName = a.name as string;
        const query = a.query as string;
        const limit = (a.limit as number) ?? 10;

        const group = loadGroup(groupName);
        if (!group) return { content: [{ type: 'text', text: `Group "${groupName}" not found.` }] };

        const { perRepo, merged } = await queryGroup(group, query, limit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ query, merged, perRepo }, null, 2),
          }],
        };
      }

      // ── group_status ───────────────────────────────────────────────────────
      case 'group_status': {
        const groupName = a.name as string;
        const group = loadGroup(groupName);
        if (!group) return { content: [{ type: 'text', text: `Group "${groupName}" not found.` }] };

        const registry = loadRegistry();
        const now = Date.now();

        const memberStatus = group.members.map((m) => {
          const regEntry = registry.find((r) => r.name === m.registryName);
          if (!regEntry) return { groupPath: m.groupPath, registryName: m.registryName, status: 'NOT_IN_REGISTRY' };

          const meta = loadMetadata(regEntry.path);
          if (!meta) return { groupPath: m.groupPath, registryName: m.registryName, repoPath: regEntry.path, status: 'NOT_INDEXED' };

          const ageMin = Math.round((now - new Date(meta.indexedAt).getTime()) / 60000);
          const stale = ageMin > 1440;
          return {
            groupPath: m.groupPath,
            registryName: m.registryName,
            repoPath: regEntry.path,
            indexedAt: meta.indexedAt,
            ageMinutes: ageMin,
            status: stale ? 'STALE' : 'OK',
            stats: meta.stats,
          };
        });

        const syncAge = group.lastSync
          ? Math.round((now - new Date(group.lastSync).getTime()) / 60000)
          : null;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              group: groupName,
              lastSync: group.lastSync ?? null,
              syncAgeMinutes: syncAge,
              members: memberStatus,
            }, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
}

// ─── Resources section returns to createMcpServer via separate call ──────────
// The Resources handlers need to be registered inside createMcpServer.
// (See below where we call registerResources(server, graph, repoName).)

function registerResources(server: Server, graph: KnowledgeGraph, repoName: string): void {
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
}

export async function startMcpStdio(graph: KnowledgeGraph, repoName: string, workspaceRoot?: string): Promise<void> {
  if (process.env['CODE_INTEL_TOKEN']) {
    process.stderr.write('[code-intel] CODE_INTEL_TOKEN is configured — all tool calls must include { "_token": "<value>" } in their arguments.\n');
  }
  const server = createMcpServer(graph, repoName, workspaceRoot);

  // Log available tools to stderr so editors (VS Code, Claude Desktop) show them in the MCP log.
  const toolNames = [
    'repos', 'overview', 'search', 'inspect', 'blast_radius', 'file_symbols',
    'find_path', 'list_exports', 'routes', 'clusters', 'flows', 'detect_changes',
    'raw_query', 'group_list', 'group_sync', 'group_contracts', 'group_query', 'group_status',
  ];
  process.stderr.write(`[code-intel] MCP server ready — repo: ${repoName}, ${toolNames.length} tools:\n`);
  process.stderr.write(`[code-intel]   ${toolNames.join(', ')}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function findNodeByName(graph: KnowledgeGraph, name: string) {
  for (const node of graph.allNodes()) {
    if (node.name === name) return node;
  }
  return undefined;
}

/**
 * Parse a unified diff text and return a list of changed files with their
 * changed line numbers (new-file side, i.e. "+" lines).
 */
function parseDiff(diffText: string): { filePath: string; changedLines: number[] }[] {
  const result: { filePath: string; changedLines: number[] }[] = [];
  let currentFile: string | null = null;
  let currentNewLine = 0;
  const changedLinesMap = new Map<string, number[]>();

  for (const raw of diffText.split('\n')) {
    // diff --git a/src/foo.ts b/src/foo.ts  OR  +++ b/src/foo.ts
    const fileMatch = raw.match(/^\+\+\+ b\/(.+)/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!changedLinesMap.has(currentFile)) changedLinesMap.set(currentFile, []);
      continue;
    }

    // @@ -oldStart,oldLen +newStart,newLen @@
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentNewLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentFile) continue;

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      changedLinesMap.get(currentFile)!.push(currentNewLine);
      currentNewLine++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // deleted line: don't advance new-side line counter
    } else if (!raw.startsWith('\\')) {
      currentNewLine++;
    }
  }

  for (const [filePath, changedLines] of changedLinesMap) {
    result.push({ filePath, changedLines });
  }
  return result;
}
