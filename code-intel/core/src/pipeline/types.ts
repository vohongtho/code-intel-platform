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
  onProgress?: (phase: string, message: string) => void;
}

export interface Phase {
  name: string;
  dependencies: string[];
  execute(context: PipelineContext, depResults: Map<string, PhaseResult>): Promise<PhaseResult>;
}
