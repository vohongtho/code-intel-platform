/**
 * OpenAPI 3.1 specification for code-intel HTTP API v1.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Code Intelligence Platform API',
    version: '1.0.0',
    description: 'HTTP API for the Code Intelligence Platform — explore knowledge graphs, search symbols, run blast-radius analysis, and manage repositories.',
    license: { name: 'MIT' },
    contact: { name: 'vohongtho', url: 'https://github.com/vohongtho/code-intel-platform' },
  },
  servers: [
    { url: '/api/v1', description: 'Current API version' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API token created with `code-intel token create`',
      },
      SessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'code_intel_session',
        description: 'Session cookie obtained from POST /auth/login',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'CI-1000' },
              message: { type: 'string' },
              hint: { type: 'string' },
              requestId: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
            },
            required: ['code', 'message'],
          },
        },
      },
      CodeNode: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['function', 'class', 'interface', 'method', 'variable', 'file', 'module', 'type', 'enum', 'cluster', 'flow'] },
          filePath: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          exported: { type: 'boolean' },
          language: { type: 'string' },
        },
        required: ['id', 'name', 'kind', 'filePath'],
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'error'] },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }, { SessionCookie: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Detailed health status',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Health details', content: { 'application/json': { schema: { '$ref': '#/components/schemas/HealthResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/repos': {
      get: {
        tags: ['Repositories'],
        summary: 'List indexed repositories',
        responses: {
          '200': { description: 'List of repos', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/graph/{repo}': {
      get: {
        tags: ['Graph'],
        summary: 'Download full graph for a repository',
        parameters: [{ name: 'repo', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Graph nodes and edges', content: { 'application/json': { schema: { type: 'object', properties: { nodes: { type: 'array' }, edges: { type: 'array' } } } } } },
          '404': { description: 'Repo not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/search': {
      post: {
        tags: ['Search'],
        summary: 'BM25 text search across all symbols',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' },
                  limit: { type: 'integer', default: 20 },
                  repo: { type: 'string', description: 'Optional repo filter' },
                },
                required: ['query'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Search results', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { '$ref': '#/components/schemas/CodeNode' } } } } } } },
        },
      },
    },
    '/vector-search': {
      post: {
        tags: ['Search'],
        summary: 'Semantic vector search using embeddings',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } }, required: ['query'] } } },
        },
        responses: {
          '200': { description: 'Vector search results', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/nodes/{id}': {
      get: {
        tags: ['Nodes'],
        summary: 'Get detailed information about a symbol node',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Node detail', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Node not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/blast-radius': {
      post: {
        tags: ['Analysis'],
        summary: 'Compute blast radius (impact) of a symbol change',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  target: { type: 'string', description: 'Symbol name or node ID' },
                  direction: { type: 'string', enum: ['callers', 'callees', 'both'], default: 'both' },
                  max_hops: { type: 'integer', default: 5 },
                  repo: { type: 'string' },
                },
                required: ['target'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Blast radius result', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Symbol not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/flows': {
      get: {
        tags: ['Graph'],
        summary: 'List execution flows detected in the graph',
        parameters: [{ name: 'repo', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'List of flows', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/clusters': {
      get: {
        tags: ['Graph'],
        summary: 'List community clusters detected in the graph',
        parameters: [{ name: 'repo', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'List of clusters', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/groups': {
      get: {
        tags: ['Groups'],
        summary: 'List all multi-repo groups',
        responses: {
          '200': { description: 'List of groups', content: { 'application/json': { schema: { type: 'array' } } } },
        },
      },
    },
    '/groups/{name}': {
      get: {
        tags: ['Groups'],
        summary: 'Get group configuration',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Group config', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Group not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/files/read': {
      post: {
        tags: ['Files'],
        summary: 'Read a source file from an indexed repository',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
        },
        responses: {
          '200': { description: 'File content', content: { 'application/json': { schema: { type: 'object', properties: { content: { type: 'string' } } } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
  },
};
