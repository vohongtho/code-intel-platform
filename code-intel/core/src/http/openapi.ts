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
    '/vector-status': {
      get: {
        tags: ['Search'],
        summary: 'Check whether the vector index is ready',
        responses: {
          '200': { description: 'Vector index status', content: { 'application/json': { schema: { type: 'object', properties: { ready: { type: 'boolean' }, building: { type: 'boolean' } }, required: ['ready', 'building'] } } } },
        },
      },
    },
    '/source': {
      get: {
        tags: ['Files'],
        summary: 'Get source code preview with context around specified lines',
        description: 'Returns the file content around the specified line range (±20 lines context), with language detection. Requires viewer role.',
        security: [{ BearerAuth: [] }, { SessionCookie: [] }],
        parameters: [
          {
            name: 'file',
            in: 'query',
            required: true,
            description: 'Absolute path to the file',
            schema: { type: 'string' },
          },
          {
            name: 'startLine',
            in: 'query',
            required: false,
            description: 'Start line number (1-indexed)',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'endLine',
            in: 'query',
            required: false,
            description: 'End line number (1-indexed)',
            schema: { type: 'integer', minimum: 1 },
          },
        ],
        responses: {
          '200': {
            description: 'Source code preview',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    content: { type: 'string', description: 'File content (with context lines)' },
                    language: { type: 'string', description: 'Detected programming language', example: 'typescript' },
                    startLine: { type: 'integer', description: 'Actual start line returned (with context)' },
                    endLine: { type: 'integer', description: 'Actual end line returned (with context)' },
                  },
                  required: ['content', 'language', 'startLine', 'endLine'],
                },
              },
            },
          },
          '400': { description: 'Bad request (missing file param or path traversal detected)', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Forbidden (file outside indexed repos)', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'File not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/grep': {
      post: {
        tags: ['Files'],
        summary: 'Grep for a regex pattern across indexed file nodes',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pattern: { type: 'string', description: 'Regular expression pattern' },
                  file_paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of file paths to search' },
                },
                required: ['pattern'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Grep results', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' } } } } } } } } },
          '400': { description: 'Bad request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/cypher': {
      post: {
        tags: ['Graph'],
        summary: 'Run a Cypher-like query against the knowledge graph',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
        },
        responses: {
          '200': { description: 'Query results', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array' } } } } } },
          '400': { description: 'Bad request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/jobs': {
      get: {
        tags: ['Jobs'],
        summary: 'List analysis jobs with optional status/repo filters',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'running', 'success', 'failed', 'cancelled', 'dead'] } },
          { name: 'repo', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'List of jobs', content: { 'application/json': { schema: { type: 'object', properties: { jobs: { type: 'array', items: { type: 'object' } } } } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/jobs/{id}': {
      delete: {
        tags: ['Jobs'],
        summary: 'Cancel an analysis job',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Job cancelled', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' }, id: { type: 'string' } } } } } },
          '404': { description: 'Job not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Job cannot be cancelled', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/groups/{name}/contracts': {
      get: {
        tags: ['Groups'],
        summary: 'Get the last sync result / contracts for a group',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Sync result', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/groups/{name}/sync': {
      post: {
        tags: ['Groups'],
        summary: 'Sync all members of a group and compute cross-repo contracts',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Sync result', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Group not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/groups/{name}/search': {
      post: {
        tags: ['Groups'],
        summary: 'Search across all repos in a group',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer', default: 20 } }, required: ['q'] } } },
        },
        responses: {
          '200': { description: 'Search results per repo and merged', content: { 'application/json': { schema: { type: 'object', properties: { perRepo: { type: 'object' }, merged: { type: 'array' } } } } } },
          '400': { description: 'Bad request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Group not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/groups/{name}/graph': {
      get: {
        tags: ['Groups'],
        summary: 'Retrieve the merged knowledge graph for all repos in a group',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Merged graph nodes and edges', content: { 'application/json': { schema: { type: 'object', properties: { nodes: { type: 'array' }, edges: { type: 'array' } } } } } },
          '404': { description: 'Group not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/query': {
      post: {
        tags: ['GQL'],
        summary: 'Execute a GQL (Graph Query Language) query against the knowledge graph',
        description: 'Supports FIND, TRAVERSE, PATH, and COUNT statements. Requires viewer role minimum.',
        security: [{ BearerAuth: [] }, { SessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gql: {
                    type: 'string',
                    description: 'GQL query string',
                    example: 'FIND function WHERE name CONTAINS "auth"',
                  },
                  format: {
                    type: 'string',
                    enum: ['json', 'table', 'csv'],
                    default: 'json',
                    description: 'Output format',
                  },
                },
                required: ['gql'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'GQL execution result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nodes: { type: 'array', items: { '$ref': '#/components/schemas/CodeNode' } },
                    edges: { type: 'array', items: { type: 'object' } },
                    groups: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, count: { type: 'integer' } } } },
                    path: { type: 'array', items: { '$ref': '#/components/schemas/CodeNode' }, nullable: true },
                    executionTimeMs: { type: 'number' },
                    truncated: { type: 'boolean' },
                    totalCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { description: 'Missing gql field', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Forbidden (insufficient role)', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '422': { description: 'GQL parse error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/query/explain': {
      post: {
        tags: ['GQL'],
        summary: 'Explain a GQL query — returns the execution plan without running it',
        description: 'Returns a query plan object describing the steps that would be executed. Requires viewer role minimum.',
        security: [{ BearerAuth: [] }, { SessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gql: { type: 'string', description: 'GQL query string', example: 'FIND function WHERE name CONTAINS "auth"' },
                },
                required: ['gql'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Query plan',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    plan: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['FIND', 'TRAVERSE', 'PATH', 'COUNT'] },
                        gql: { type: 'string' },
                        steps: { type: 'array', items: { type: 'object' } },
                        estimatedCost: { type: 'number' },
                      },
                    },
                    graphSize: { type: 'object', properties: { nodes: { type: 'integer' }, edges: { type: 'integer' } } },
                  },
                },
              },
            },
          },
          '400': { description: 'Missing gql field', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '422': { description: 'GQL parse error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
  },
};
