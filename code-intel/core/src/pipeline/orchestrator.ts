import type { Phase, PhaseResult, PipelineContext } from './types.js';
import { validateDAG, topologicalSort } from './dag-validator.js';

export interface PipelineRunResult {
  success: boolean;
  results: Map<string, PhaseResult>;
  totalDuration: number;
}

export async function runPipeline(
  phases: Phase[],
  context: PipelineContext,
): Promise<PipelineRunResult> {
  const errors = validateDAG(phases);
  if (errors.length > 0) {
    throw new Error(`Pipeline validation failed:\n${errors.map((e) => e.message).join('\n')}`);
  }

  const sorted = topologicalSort(phases);
  const results = new Map<string, PhaseResult>();
  const startTime = Date.now();
  let success = true;

  for (const phase of sorted) {
    context.onProgress?.(phase.name, 'running');
    const phaseStart = Date.now();

    try {
      const depResults = new Map<string, PhaseResult>();
      for (const dep of phase.dependencies) {
        const depResult = results.get(dep);
        if (depResult) depResults.set(dep, depResult);
      }

      const result = await phase.execute(context, depResults);
      results.set(phase.name, result);
      context.onProgress?.(phase.name, result.status);

      if (result.status === 'failed') {
        success = false;
        break;
      }
    } catch (err) {
      const result: PhaseResult = {
        status: 'failed',
        duration: Date.now() - phaseStart,
        message: err instanceof Error ? err.message : String(err),
      };
      results.set(phase.name, result);
      context.onProgress?.(phase.name, 'failed');
      success = false;
      break;
    }
  }

  return {
    success,
    results,
    totalDuration: Date.now() - startTime,
  };
}
