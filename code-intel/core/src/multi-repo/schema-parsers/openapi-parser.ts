import fs from 'node:fs';
import path from 'node:path';
import { scanForFiles } from './file-scanner.js';

export interface OpenAPIContract {
  name: string;      // "GET /users/{id}"
  kind: 'route';
  method: string;
  path: string;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  filePath: string;
}

const OPENAPI_FILENAMES = new Set([
  'openapi.yaml', 'openapi.json', 'openapi.yml',
  'swagger.yaml', 'swagger.json', 'swagger.yml',
]);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// js-yaml is not in package.json — only JSON files are parsed.
// YAML files are skipped (no YAML support without js-yaml).
function tryParseFile(filePath: string): Record<string, unknown> | null {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, 'utf-8');
  if (ext === '.json') {
    try { return JSON.parse(content) as Record<string, unknown>; } catch { return null; }
  }
  // YAML: skip (js-yaml not available)
  return null;
}

export async function parseOpenAPIContracts(repoRoot: string): Promise<OpenAPIContract[]> {
  const files = scanForFiles(repoRoot, (name) => OPENAPI_FILENAMES.has(name));
  const contracts: OpenAPIContract[] = [];

  for (const filePath of files) {
    const spec = tryParseFile(filePath);
    if (!spec) continue;

    const paths = spec['paths'] as Record<string, unknown> | undefined;
    if (!paths || typeof paths !== 'object') continue;

    for (const [pathStr, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      const ops = pathItem as Record<string, unknown>;

      for (const method of HTTP_METHODS) {
        if (!(method in ops)) continue;
        const operation = ops[method] as Record<string, unknown> | undefined;
        if (!operation) continue;

        const requestBody = operation['requestBody'] as Record<string, unknown> | undefined;
        const requestSchema = requestBody?.['content']
          ? ((requestBody['content'] as Record<string, unknown>)['application/json'] as Record<string, unknown>)?.['schema'] as Record<string, unknown> | undefined
          : undefined;

        const responses = operation['responses'] as Record<string, unknown> | undefined;
        const ok200 = responses?.['200'] as Record<string, unknown> | undefined;
        const responseSchema = ok200?.['content']
          ? ((ok200['content'] as Record<string, unknown>)['application/json'] as Record<string, unknown>)?.['schema'] as Record<string, unknown> | undefined
          : undefined;

        contracts.push({
          name: `${method.toUpperCase()} ${pathStr}`,
          kind: 'route',
          method: method.toUpperCase(),
          path: pathStr,
          ...(requestSchema ? { requestSchema } : {}),
          ...(responseSchema ? { responseSchema } : {}),
          filePath,
        });
      }
    }
  }

  return contracts;
}
