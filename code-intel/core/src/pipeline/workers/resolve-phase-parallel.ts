import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { resolvePhase } from '../phases/resolve-phase.js';

export const resolvePhaseParallel: Phase = {
  name: 'resolve',
  dependencies: ['parse'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    return resolvePhase.execute(context, new Map());
  },
};
