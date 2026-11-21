/**
 * telemetry.ts
 *
 * Workflow/system-flow counters. Only phases, outcomes and counts are
 * recorded — task text, source text and paths never reach telemetry.
 */

import {
  systemFlowStitchTotal,
  workflowPhaseTransitionsTotal,
  workflowSemanticDeltasTotal,
  workflowVerificationsTotal,
  workflowVerifyDurationSeconds,
} from '../../observability/metrics.js';
import type { ChangeWorkflowPhase, VerificationCounts, VerificationOutcome } from './session-types.js';

export function recordWorkflowTransition(from: ChangeWorkflowPhase, to: ChangeWorkflowPhase): void {
  workflowPhaseTransitionsTotal.inc({ from, to });
}

export function recordWorkflowVerification(outcome: VerificationOutcome, durationSeconds: number, counts: VerificationCounts): void {
  workflowVerificationsTotal.inc({ outcome });
  workflowVerifyDurationSeconds.observe(durationSeconds);
  workflowSemanticDeltasTotal.inc({ kind: 'planned' }, counts.plannedConditions);
  workflowSemanticDeltasTotal.inc({ kind: 'satisfied' }, counts.satisfied);
  workflowSemanticDeltasTotal.inc({ kind: 'unexpected' }, counts.unexpectedChanges);
}

export function recordSystemFlowStitch(counters: { segments: number; repositoryHops: number; candidates: number; capHits: number }): void {
  systemFlowStitchTotal.inc({ kind: 'segments' }, counters.segments);
  systemFlowStitchTotal.inc({ kind: 'repository-hops' }, counters.repositoryHops);
  systemFlowStitchTotal.inc({ kind: 'candidates' }, counters.candidates);
  systemFlowStitchTotal.inc({ kind: 'cap-hits' }, counters.capHits);
}
