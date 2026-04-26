export type PipelinePhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineProgress {
  phaseName: string;
  status: PipelinePhaseStatus;
  message?: string;
  current?: number;
  total?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface PipelineResult {
  success: boolean;
  phases: PipelineProgress[];
  totalDuration: number;
  stats: {
    nodes: number;
    edges: number;
    files: number;
  };
}
