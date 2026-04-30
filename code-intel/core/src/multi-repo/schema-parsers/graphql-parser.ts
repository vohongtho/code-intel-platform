import fs from 'node:fs';
import { scanForFiles } from './file-scanner.js';

export interface GraphQLContract {
  name: string;      // "query.getUser" or "type.User"
  kind: 'graphql';
  operation: 'query' | 'mutation' | 'subscription' | 'type';
  fields?: string[];
  filePath: string;
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

export async function parseGraphQLContracts(repoRoot: string): Promise<GraphQLContract[]> {
  const files = scanForFiles(repoRoot, (name) => name.endsWith('.graphql') || name.endsWith('.gql'));
  const contracts: GraphQLContract[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Match all type blocks (including Query, Mutation, Subscription, and others)
    const typeRegex = /type\s+(\w+)\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = typeRegex.exec(content)) !== null) {
      const typeName = match[1];
      const body = match[2];
      const fields = extractFieldNames(body);

      const lcName = typeName.toLowerCase();
      if (lcName === 'query') {
        for (const field of fields) {
          contracts.push({ name: `query.${field}`, kind: 'graphql', operation: 'query', fields, filePath });
        }
      } else if (lcName === 'mutation') {
        for (const field of fields) {
          contracts.push({ name: `mutation.${field}`, kind: 'graphql', operation: 'mutation', fields, filePath });
        }
      } else if (lcName === 'subscription') {
        for (const field of fields) {
          contracts.push({ name: `subscription.${field}`, kind: 'graphql', operation: 'subscription', fields, filePath });
        }
      } else {
        contracts.push({ name: `type.${typeName}`, kind: 'graphql', operation: 'type', fields, filePath });
      }
    }
  }

  return contracts;
}
