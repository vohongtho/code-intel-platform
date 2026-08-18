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
