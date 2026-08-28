import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import { buildChangeContext } from '../query/change-context.js';
import { parseDiffFiles } from '../query/pr-impact.js';
import { verifyIndexTrust } from '../storage/index-trust.js';

export interface ChangeContextTransportDeps {
  repoDir: string;
  graph: KnowledgeGraph;
}

export const changeContextOpenApi = {
  openapi: '3.1.0',
  info: { title: 'Code Intel Change Context API', version: '1.0.8' },
  paths: {
    '/health': {
      get: { summary: 'Transport health', responses: { '200': { description: 'Healthy' } } },
    },
    '/api/v1/index-status': {
      get: { summary: 'Verify index integrity and freshness', responses: { '200': { description: 'Index trust result' } } },
    },
    '/api/v1/change-context': {
      post: {
        summary: 'Build a coding-agent change context package',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  changedFiles: { type: 'array', items: { type: 'string' } },
                  diff: { type: 'string' },
                  maxHops: { type: 'number', minimum: 1, maximum: 10 },
                  maxTokens: { type: 'number', minimum: 128, maximum: 6000 },
                  maxChangedSymbols: { type: 'number', minimum: 1, maximum: 100 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Change context result' },
          '400': { description: 'Invalid request' },
        },
      },
    },
  },
} as const;

function normalizeChangedFiles(value: unknown, diff: unknown): string[] {
  const files = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  if (typeof diff === 'string') files.push(...parseDiffFiles(diff));
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort();
}

function changeContextFromInput(repoDir: string, graph: KnowledgeGraph, input: Record<string, unknown>) {
  const changedFiles = normalizeChangedFiles(input['changedFiles'], input['diff']);
  if (changedFiles.length === 0) throw new Error('Supply changedFiles or diff');
  return buildChangeContext(graph, {
    repoDir,
    changedFiles,
    maxHops: typeof input['maxHops'] === 'number' ? input['maxHops'] : undefined,
    maxTokens: typeof input['maxTokens'] === 'number' ? input['maxTokens'] : undefined,
    maxChangedSymbols: typeof input['maxChangedSymbols'] === 'number' ? input['maxChangedSymbols'] : undefined,
  });
}

export async function startChangeContextMcp(deps: ChangeContextTransportDeps): Promise<void> {
  const server = new Server(
    { name: 'code-intel-change-context', version: '1.0.8' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'change_context',
        description: 'Build impact, risk, coverage gaps, test suggestions and a token-bounded context document for changed files.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            changedFiles: { type: 'array', items: { type: 'string' } },
            diff: { type: 'string' },
            maxHops: { type: 'number' },
            maxTokens: { type: 'number' },
            maxChangedSymbols: { type: 'number' },
          },
        },
      },
      {
        name: 'index_status',
        description: 'Verify index integrity, generation consistency and source freshness.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === 'change_context') {
        const result = changeContextFromInput(deps.repoDir, deps.graph, (request.params.arguments ?? {}) as Record<string, unknown>);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      if (request.params.name === 'index_status') {
        return { content: [{ type: 'text', text: JSON.stringify(verifyIndexTrust(deps.repoDir)) }] };
      }
      return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  await server.connect(new StdioServerTransport());
}

export function startChangeContextHttp(
  deps: ChangeContextTransportDeps,
  port: number,
  host = '127.0.0.1',
): HttpServer {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'code-intel-change-context', version: '1.0.8' }));
  app.get('/openapi.json', (_req, res) => res.json(changeContextOpenApi));
  app.get('/api/v1/index-status', (_req, res) => res.json(verifyIndexTrust(deps.repoDir)));
  app.post('/api/v1/change-context', (req, res) => {
    try {
      res.json(changeContextFromInput(deps.repoDir, deps.graph, req.body as Record<string, unknown>));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return app.listen(port, host, () => {
    process.stderr.write(`change-context HTTP listening on http://${host}:${port}\n`);
  });
}
