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
      CountGroup: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          count: { type: 'integer', minimum: 0 },
        },
        required: ['key', 'count'],
      },
      GQLResult: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['nodes', 'traversal', 'path', 'aggregate'] },
          nodes: { type: 'array', items: { '$ref': '#/components/schemas/CodeNode' } },
          edges: { type: 'array', items: { type: 'object' } },
          groups: { type: 'array', items: { '$ref': '#/components/schemas/CountGroup' } },
          path: { anyOf: [{ type: 'array', items: { '$ref': '#/components/schemas/CodeNode' } }, { type: 'null' }] },
          executionTimeMs: { type: 'number', minimum: 0 },
          truncated: { type: 'boolean' },
          totalCount: { type: 'integer', minimum: 0 },
          format: { type: 'string', enum: ['json'] },
          scope: { '$ref': '#/components/schemas/ResolvedSearchScope' },
        },
        required: ['kind', 'nodes', 'edges', 'groups', 'path', 'executionTimeMs', 'truncated', 'totalCount'],
      },
      SearchScope: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['repo'] },
              repoId: { type: 'string', description: 'Stable repository ID - does not fallback to name or path matching' },
            },
            required: ['type', 'repoId'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['group'] },
              name: { type: 'string', description: 'Group name' },
            },
            required: ['type', 'name'],
          },
        ],
      },
      ResolvedSearchScope: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['repo'] },
              repoId: { type: 'string' },
              repoName: { type: 'string' },
            },
            required: ['type', 'repoId', 'repoName'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['group'] },
              name: { type: 'string' },
            },
            required: ['type', 'name'],
          },
        ],
      },
      SearchRequest: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'integer', default: 20 },
          mode: { type: 'string', enum: ['bm25', 'vector', 'hybrid'], default: 'hybrid', description: 'Malformed explicit scope fails closed with 400; unknown explicit repo/group targets return 404.' },
          scope: { '$ref': '#/components/schemas/SearchScope' },
          repoId: { type: 'string', description: 'Canonical repository selector - must be a stable repository ID; does not fallback to name or path matching' },
          repo: { type: 'string', description: 'Deprecated legacy repo selector - allows compatibility resolution by stable ID, name, or path' },
          group: { type: 'string', description: 'Deprecated legacy group selector' },
        },
        required: ['query'],
      },
      SearchResponse: {
        type: 'object',
        properties: {
          results: { type: 'array', items: { '$ref': '#/components/schemas/CodeNode' } },
          searchMode: { type: 'string', enum: ['bm25', 'vector', 'hybrid'] },
          scope: { '$ref': '#/components/schemas/ResolvedSearchScope' },
          deprecated: { type: 'boolean' },
          deprecation: { type: 'string' },
          vectorReady: { type: 'boolean' },
          total: { type: 'integer' },
          offset: { type: 'integer' },
          limit: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
        required: ['results', 'searchMode'],
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
    '/graph/{repoId}': {
      get: {
        tags: ['Graph'],
        summary: 'Download full graph for a repository',
        parameters: [{ name: 'repoId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Graph nodes and edges', content: { 'application/json': { schema: { type: 'object', properties: { nodes: { type: 'array' }, edges: { type: 'array' } } } } } },
          '404': { description: 'Repo not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/search': {
      post: {
        tags: ['Search'],
        summary: 'Canonical scoped search endpoint',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/SearchRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Search results', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SearchResponse' } } } },
          '400': { description: 'Ambiguous or invalid request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Repo or group not found', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/vector-search': {
      post: {
        tags: ['Search'],
        summary: 'Deprecated compatibility alias for scoped vector search',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { '$ref': '#/components/schemas/SearchRequest' } } },
        },
        responses: {
          '200': { description: 'Vector search results. When published vectors are missing, stale, incompatible, or corrupt, the server degrades to BM25 without mutating published artifacts.', content: { 'application/json': { schema: { '$ref': '#/components/schemas/SearchResponse' } } } },
          '400': { description: 'Ambiguous or invalid request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
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
                  repoId: { type: 'string' },
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
        parameters: [{ name: 'repoId', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'List of flows', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/clusters': {
      get: {
        tags: ['Graph'],
        summary: 'List community clusters detected in the graph',
        parameters: [{ name: 'repoId', in: 'query', schema: { type: 'string' } }],
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
    '/embeddings/models': {
      get: {
        tags: ['Search'],
        summary: 'List backend-supported embedding models',
        responses: {
          '200': {
            description: 'Embedding model catalog',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    defaultModel: { type: 'string' },
                    models: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          label: { type: 'string' },
                          provider: { type: 'string' },
                          dimension: { type: 'integer' },
                          dtype: { type: 'string' },
                          default: { type: 'boolean' },
                          available: { type: 'boolean' },
                          unavailableReason: { type: 'string' },
                          description: { type: 'string' },
                        },
                        required: ['id', 'label', 'provider', 'dimension', 'dtype', 'default', 'available'],
                      },
                    },
                  },
                  required: ['models', 'defaultModel'],
                },
              },
            },
          },
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
          {
            name: 'repoId',
            in: 'query',
            required: false,
            description: 'Repository identity used to resolve file paths',
            schema: { type: 'string' },
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
    '/groups/{name}/topology': {
      get: {
        tags: ['Groups'],
        summary: 'Get the topology of repos and cross-repo contract edges for a group',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Repos and cross-repo edges',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    repos: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, groupPath: { type: 'string' }, nodeCount: { type: 'integer' }, edgeCount: { type: 'integer' } } } },
                    edges: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' }, contractName: { type: 'string' }, confidence: { type: 'number' }, kind: { type: 'string' } } } },
                  },
                },
              },
            },
          },
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
                  scope: { '$ref': '#/components/schemas/SearchScope' },
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
                schema: { '$ref': '#/components/schemas/GQLResult' },
                examples: {
                  find: {
                    value: {
                      kind: 'nodes', nodes: [{ id: 'fn1', name: 'handleLogin', kind: 'function', filePath: 'auth/login.ts' }], edges: [], groups: [], path: null, executionTimeMs: 1, truncated: false, totalCount: 1, format: 'json',
                    },
                  },
                  traverse: {
                    value: {
                      kind: 'traversal', nodes: [{ id: 'fn1', name: 'handleLogin', kind: 'function', filePath: 'auth/login.ts' }], edges: [{ id: 'e1', source: 'fn1', target: 'fn3', kind: 'calls' }], groups: [], path: null, executionTimeMs: 2, truncated: false, totalCount: 1, format: 'json',
                    },
                  },
                  path: {
                    value: {
                      kind: 'path', nodes: [{ id: 'fn4', name: 'createUser', kind: 'function', filePath: 'user/create.ts' }, { id: 'fn5', name: 'sendEmail', kind: 'function', filePath: 'mail/send.ts' }], edges: [{ id: 'e3', source: 'fn4', target: 'fn5', kind: 'calls' }], groups: [], path: [{ id: 'fn4', name: 'createUser', kind: 'function', filePath: 'user/create.ts' }, { id: 'fn5', name: 'sendEmail', kind: 'function', filePath: 'mail/send.ts' }], executionTimeMs: 2, truncated: false, totalCount: 2, format: 'json',
                    },
                  },
                  count: {
                    value: {
                      kind: 'aggregate', nodes: [], edges: [], groups: [{ key: 'total', count: 23 }], path: null, executionTimeMs: 1, truncated: false, totalCount: 23, format: 'json',
                    },
                  },
                  groupedCount: {
                    value: {
                      kind: 'aggregate', nodes: [], edges: [], groups: [{ key: 'authentication', count: 12 }, { key: 'storage', count: 8 }, { key: '(none)', count: 3 }], path: null, executionTimeMs: 1, truncated: false, totalCount: 23, format: 'json',
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Missing gql field', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Forbidden (insufficient role)', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '408': { description: 'Truncated partial result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/GQLResult' } } } },
          '422': { description: 'GQL parse error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Unexpected internal failure or invalid internal result shape', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ErrorResponse' } } } },
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
                  scope: { '$ref': '#/components/schemas/SearchScope' },
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
