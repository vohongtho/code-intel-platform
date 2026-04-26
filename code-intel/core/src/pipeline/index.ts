export { runPipeline } from './orchestrator.js';
export type { PipelineRunResult } from './orchestrator.js';
export { validateDAG, topologicalSort } from './dag-validator.js';
export type { Phase, PhaseResult, PipelineContext } from './types.js';
export {
  scanPhase,
  structurePhase,
  parsePhase,
  resolvePhase,
  clusterPhase,
  flowPhase,
} from './phases/index.js';
