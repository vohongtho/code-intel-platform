import type { KnowledgeGraph } from '../graph/knowledge-graph.js';

export type PipelinePhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PhaseResult {
  status: PipelinePhaseStatus;
  duration: number;
  message?: string;
}

export interface PipelineContext {
  workspaceRoot: string;
  graph: KnowledgeGraph;
  filePaths: string[];
  /** Shared file content cache — populated by parse phase, reused by resolve phase (eliminates double I/O) */
  fileCache?: Map<string, string>;
  /** Per-file sorted symbol index for O(1) enclosing-function lookup — built by parse phase */
  fileFunctionIndex?: Map<string, { id: string; startLine: number; endLine: number | undefined }[]>;
  onProgress?: (phase: string, message: string) => void;
  /** Per-phase progress callback — called with (phase, done, total) for each processed item */
  onPhaseProgress?: (phase: string, done: number, total: number) => void;
  verbose?: boolean;
}

export interface Phase {
  name: string;
  dependencies: string[];
  execute(context: PipelineContext, depResults: Map<string, PhaseResult>): Promise<PhaseResult>;
}
