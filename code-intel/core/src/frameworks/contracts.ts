import path from 'node:path';
import type { Language } from '../shared/languages.js';
import type { FactBundle } from '../semantic/fact-bundle.js';

export type FrameworkDetectionStrength = 'weak' | 'medium' | 'strong';

export interface FrameworkDetectionSignal {
  kind: 'dependency' | 'import' | 'decorator' | 'registration' | 'config';
  strength: FrameworkDetectionStrength;
  filePath: string;
  value: string;
}

export interface FrameworkDetection {
  frameworkId: string;
  adapterVersion: string;
  confidence: 'none' | 'low' | 'medium' | 'high';
  exact: boolean;
  score: number;
  signals: readonly FrameworkDetectionSignal[];
}

export interface RepositoryFactView {
  workspaceRoot: string;
  filePaths: readonly string[];
  fileCache: ReadonlyMap<string, string>;
}

/**
 * Workspace-relative, forward-slash path for a fact's `filePath`. Pipeline
 * views hand adapters absolute paths; graph file nodes are keyed by the
 * workspace-relative path, so facts must use the same form or their
 * `contains` edges dangle (and atomic publication rejects the index as
 * collapsed). Already-relative paths (unit-test views) pass through.
 */
export function workspaceRelativePath(workspaceRoot: string, filePath: string): string {
  const relative = path.isAbsolute(filePath) && workspaceRoot ? path.relative(workspaceRoot, filePath) : filePath;
  return relative.split(path.sep).join('/').replace(/^\.\//, '');
}

export interface FrameworkFactBundle extends FactBundle {}

export interface FrameworkAdapter {
  id: string;
  version: string;
  languages: readonly Language[];
  detect(view: RepositoryFactView): FrameworkDetection;
  extract(view: RepositoryFactView): FrameworkFactBundle;
}

export interface FrameworkAdapterRegistration {
  id: string;
  order: number;
  load: () => Promise<FrameworkAdapter>;
}
