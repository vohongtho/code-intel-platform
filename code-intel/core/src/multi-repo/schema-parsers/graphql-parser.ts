import fs from 'node:fs';
import path from 'node:path';
import { scanForFiles } from './file-scanner.js';
import { buildGraphQLSchemaModel } from './graphql-model.js';
import { GRAPHQL_LIMITS } from '../../semantic/protocol-contracts/graphql-types.js';

/**
 * v1.0.11 flat contract shape, kept as a migration adapter for existing callers. New code uses
 * the versioned GraphQLSchemaModel (graphql-model.ts) instead.
 */
export interface GraphQLContract {
  name: string;      // "query.getUser" or "type.User"
  kind: 'graphql';
  operation: 'query' | 'mutation' | 'subscription' | 'type';
  fields?: string[];
  filePath: string;
}

/** How deep repository scans look for schema/operation documents. */
const DOCUMENT_SCAN_DEPTH = 8;

export interface GraphQLDocumentScan {
  documents: Array<{ filePath: string; absolutePath: string; source: string }>;
  boundaries: string[];
}

/** Bounded scan for `.graphql`/`.gql` documents; `filePath` is repository-relative. */
export function scanGraphQLDocuments(repoRoot: string): GraphQLDocumentScan {
  const files = scanForFiles(repoRoot, (name) => name.endsWith('.graphql') || name.endsWith('.gql'), DOCUMENT_SCAN_DEPTH).sort();
  const boundaries: string[] = [];
  if (files.length > GRAPHQL_LIMITS.maxFilesPerRepo) boundaries.push('file-count-limit');
  const documents: GraphQLDocumentScan['documents'] = [];
  for (const absolutePath of files.slice(0, GRAPHQL_LIMITS.maxFilesPerRepo)) {
    const filePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    try {
      if (fs.statSync(absolutePath).size > GRAPHQL_LIMITS.maxFileBytes) {
        boundaries.push(`file-size-limit:${filePath}`);
        continue;
      }
      documents.push({ filePath, absolutePath, source: fs.readFileSync(absolutePath, 'utf-8') });
    } catch {
      boundaries.push(`unreadable:${filePath}`);
    }
  }
  return { documents, boundaries };
}

function extractFieldNames(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const m = line.match(/^(\w+)\s*[(:]/);
      return m ? m[1] : null;
    })
    .filter((f): f is string => f !== null);
}

/** v1.0.11 regex extraction — used only for a file the AST parser rejects. */
function legacyRegexContracts(content: string, filePath: string): GraphQLContract[] {
  const contracts: GraphQLContract[] = [];
  const typeRegex = /type\s+(\w+)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = typeRegex.exec(content)) !== null) {
    const typeName = match[1];
    const fields = extractFieldNames(match[2]);
    const lcName = typeName.toLowerCase();
    if (lcName === 'query' || lcName === 'mutation' || lcName === 'subscription') {
      for (const field of fields) contracts.push({ name: `${lcName}.${field}`, kind: 'graphql', operation: lcName, fields, filePath });
    } else {
      contracts.push({ name: `type.${typeName}`, kind: 'graphql', operation: 'type', fields, filePath });
    }
  }
  return contracts;
}

/**
 * Flat v1.0.11-compatible contracts, now produced from the AST model: one `<operation>.<field>`
 * contract per root field and one `type.<Name>` contract per other object type. A document
 * the AST parser rejects falls back to the legacy regex scan for that file only.
 */
export async function parseGraphQLContracts(repoRoot: string): Promise<GraphQLContract[]> {
  const { documents } = scanGraphQLDocuments(repoRoot);
  const contracts: GraphQLContract[] = [];

  for (const document of documents) {
    const model = buildGraphQLSchemaModel([{ filePath: document.absolutePath, source: document.source }], 'legacy');
    if (model.coverage.boundaryReasons.some((reason) => !reason.startsWith('extension-without-definition'))) {
      contracts.push(...legacyRegexContracts(document.source, document.absolutePath));
      continue;
    }
    const rootByType = new Map(Object.entries(model.rootTypes).map(([operation, typeName]) => [typeName, operation as 'query' | 'mutation' | 'subscription']));
    for (const type of model.types) {
      if (type.kind !== 'object') continue;
      const fields = (type.fields ?? []).map((field) => field.name);
      const operation = rootByType.get(type.name);
      if (operation) {
        for (const field of fields) contracts.push({ name: `${operation}.${field}`, kind: 'graphql', operation, fields, filePath: document.absolutePath });
      } else {
        contracts.push({ name: `type.${type.name}`, kind: 'graphql', operation: 'type', fields, filePath: document.absolutePath });
      }
    }
  }

  return contracts;
}
