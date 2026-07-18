/**
 * ponytail: compatibility no-op for legacy deep imports.
 * Skill generation was removed from `code-intel analyze`.
 * Remove this module after downstream imports disappear.
 */

import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export interface SkillSummary {
  name: string;
  label: string;
  symbolCount: number;
  fileCount: number;
}

export async function writeSkillFiles(
  _graph: KnowledgeGraph,
  _workspaceRoot: string,
  _projectName: string,
): Promise<{ skills: SkillSummary[]; outputDir: string }> {
  return { skills: [], outputDir: '' };
}
