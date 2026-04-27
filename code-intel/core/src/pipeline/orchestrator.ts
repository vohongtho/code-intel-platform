import type { Phase, PhaseResult, PipelineContext } from './types.js';
import { validateDAG, topologicalSort } from './dag-validator.js';
import { withSpan, isTracingEnabled } from '../observability/tracing.js';
import { pipelinePhaseDurationSeconds } from '../observability/metrics.js';

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

    const runPhase = async (): Promise<{ result: PhaseResult }> => {
      const depResults = new Map<string, PhaseResult>();
      for (const dep of phase.dependencies) {
        const depResult = results.get(dep);
        if (depResult) depResults.set(dep, depResult);
      }
      const result = await phase.execute(context, depResults);
      return { result };
    };

    try {
      let result: PhaseResult;
      if (isTracingEnabled()) {
        const out = await withSpan(
          `pipeline.phase.${phase.name}`,
          { 'pipeline.phase': phase.name },
          async () => runPhase(),
        );
        result = out.result;
      } else {
        result = (await runPhase()).result;
      }

      const durationSec = (Date.now() - phaseStart) / 1000;
      pipelinePhaseDurationSeconds.observe({ phase: phase.name, status: result.status }, durationSec);

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
      pipelinePhaseDurationSeconds.observe({ phase: phase.name, status: 'failed' }, (Date.now() - phaseStart) / 1000);
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
