/**
 * Saved Queries — persist GQL queries to .code-intel/queries/<name>.gql
 */

import fs from 'node:fs';
import path from 'node:path';

export interface SavedQueryInfo {
  name: string;
  content: string;
  filePath: string;
  savedAt: string;
}

/**
 * Returns the queries directory for a workspace.
 */
function getQueriesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.code-intel', 'queries');
}

/**
 * Ensure the queries directory exists.
 */
function ensureQueriesDir(workspaceRoot: string): string {
  const dir = getQueriesDir(workspaceRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save a GQL query to .code-intel/queries/<name>.gql
 */
export function saveQuery(workspaceRoot: string, name: string, gql: string): void {
  const dir = ensureQueriesDir(workspaceRoot);
  const filePath = path.join(dir, `${name}.gql`);
  fs.writeFileSync(filePath, gql, 'utf-8');
}

/**
 * Load a saved GQL query by name.
 * Returns null if not found.
 */
export function loadQuery(workspaceRoot: string, name: string): string | null {
  const dir = getQueriesDir(workspaceRoot);
  const filePath = path.join(dir, `${name}.gql`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * List all saved queries.
 */
export function listQueries(workspaceRoot: string): SavedQueryInfo[] {
  const dir = getQueriesDir(workspaceRoot);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gql'));
  return files.map((f) => {
    const filePath = path.join(dir, f);
    const name = f.replace(/\.gql$/, '');
    const content = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);
    return {
      name,
      content,
      filePath,
      savedAt: stat.mtime.toISOString(),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete a saved query by name.
 * Returns true if deleted, false if not found.
 */
export function deleteQuery(workspaceRoot: string, name: string): boolean {
  const dir = getQueriesDir(workspaceRoot);
  const filePath = path.join(dir, `${name}.gql`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/**
 * Check if a saved query exists.
 */
export function queryExists(workspaceRoot: string, name: string): boolean {
  const dir = getQueriesDir(workspaceRoot);
  const filePath = path.join(dir, `${name}.gql`);
  return fs.existsSync(filePath);
}
