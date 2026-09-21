import type { FrameworkAdapter, FrameworkDetection, FrameworkDetectionSignal, RepositoryFactView } from './contracts.js';

function signalWeight(signal: FrameworkDetectionSignal): number {
  switch (signal.strength) {
    case 'strong': return 5;
    case 'medium': return 3;
    case 'weak': return 1;
  }
}

function confidenceFor(score: number): FrameworkDetection['confidence'] {
  if (score >= 10) return 'high';
  if (score >= 6) return 'medium';
  if (score >= 2) return 'low';
  return 'none';
}

export function summarizeFrameworkDetection(signals: readonly FrameworkDetectionSignal[], frameworkId: string, adapterVersion: string): FrameworkDetection {
  const score = signals.reduce((total, signal) => total + signalWeight(signal), 0);
  const strongKinds = new Set(signals.filter((signal) => signal.strength === 'strong').map((signal) => signal.kind));
  const confidence = confidenceFor(score);
  const exact = strongKinds.size >= 2 || (strongKinds.size >= 1 && score >= 8);
  return { frameworkId, adapterVersion, confidence, exact, score, signals };
}

export async function detectFrameworks(view: RepositoryFactView, adapters: readonly FrameworkAdapter[]): Promise<FrameworkDetection[]> {
  return adapters
    .map((adapter) => adapter.detect(view))
    .filter((detection) => detection.confidence !== 'none' || detection.signals.length > 0)
    .sort((left, right) => right.score - left.score || left.frameworkId.localeCompare(right.frameworkId));
}
