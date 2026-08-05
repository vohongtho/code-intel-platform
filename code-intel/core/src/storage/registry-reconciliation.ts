/**
 * registry-reconciliation.ts
 * 
 * No-op analyze registry reconciliation.
 * 
 * When a repository has a valid active published generation but its global
 * registry entry is missing, this module restores the entry without creating
 * a new generation or mutating published artifacts.
 */
import path from 'node:path';
import type { RepoEntry } from './repo-registry.js';
import {
  loadRegistry,
  findRepoByPath,
  findRepoByName,
  upsertRepo,
} from './repo-registry.js';
import type { IndexMetadata } from './metadata.js';

export type ReconciliationOutcome = 'unchanged' | 'registered' | 'conflict';

export interface ReconciliationResult {
  outcome: ReconciliationOutcome;
  entry?: RepoEntry;
  message: string;
  guidance?: string;
}

export interface ReconciliationInput {
  workspaceRoot: string;
  requestedName?: string;
  metadata: IndexMetadata;
}

/**
 * Reconcile a missing registry entry for a healthy published repository.
 * 
 * This is called during no-op analyze when:
 * - The repository has a valid active published generation
 * - But the global registry no longer contains the repository
 * 
 * The function:
 * - Restores the missing registry entry using published metadata
 * - Detects and reports rename/relink conflicts
 * - Never creates a new generation or mutates published artifacts
 * 
 * @param input - workspace root, optional requested name, and metadata
 * @returns reconciliation result with outcome and guidance
 */
export function reconcileRegistryEntry(input: ReconciliationInput): ReconciliationResult {
  const { workspaceRoot, requestedName, metadata } = input;
  const normalizedPath = path.resolve(workspaceRoot);
  
  // Determine the target name: requested name, or basename of path as fallback
  const targetName = requestedName ?? path.basename(normalizedPath);
  
  const registry = loadRegistry();
  const existingByPath = findRepoByPath(normalizedPath, registry);
  const existingByName = findRepoByName(targetName, registry);
  
  // Case 1: Entry exists for this path
  if (existingByPath) {
    // Check if requested name matches existing name
    if (requestedName && requestedName !== existingByPath.name) {
      // Requested name differs from existing - this is a rename conflict
      return {
        outcome: 'conflict',
        message: `Path "${normalizedPath}" is already registered as "${existingByPath.name}"`,
        guidance: `Use the rename flow to change the repository name from "${existingByPath.name}" to "${requestedName}".`,
      };
    }
    
    // Entry exists and matches - nothing to do
    return {
      outcome: 'unchanged',
      entry: existingByPath,
      message: `Repository "${existingByPath.name}" is already registered at path "${normalizedPath}".`,
    };
  }
  
  // Case 2: No entry for this path - check for name collision
  if (existingByName) {
    // Target name is already linked to a different path - this is a relink conflict
    return {
      outcome: 'conflict',
      message: `Repository name "${targetName}" is already linked to path "${existingByName.path}"`,
      guidance: `Use the relink flow to move repository "${targetName}" from "${existingByName.path}" to "${normalizedPath}".`,
    };
  }
  
  // Case 3: No conflicts - restore the missing entry
  try {
    const restored = upsertRepo({
      id: metadata.repoId,
      name: targetName,
      path: normalizedPath,
      indexedAt: metadata.indexedAt,
      stats: {
        nodes: metadata.stats.nodes,
        edges: metadata.stats.edges,
        files: metadata.stats.files,
      },
    });
    
    return {
      outcome: 'registered',
      entry: restored,
      message: `Restored missing registry entry for repository "${restored.name}" at path "${normalizedPath}".`,
    };
  } catch (err) {
    // Unexpected error during upsert (e.g., validation failure)
    return {
      outcome: 'conflict',
      message: `Failed to restore registry entry: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
