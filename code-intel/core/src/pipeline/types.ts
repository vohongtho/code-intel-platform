import type { KnowledgeGraph } from '../graph/knowledge-graph.js';
import type { FrameworkDetection } from '../frameworks/contracts.js';
import type { LLMConfig } from '../llm/provider.js';

export type PipelinePhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PhaseResult {
  status: PipelinePhaseStatus;
  duration: number;
  message?: string;
  /** v1.0.0 profiling — heap MB before phase (set by orchestrator) */
  memoryBeforeMB?: number;
  /** v1.0.0 profiling — heap MB after phase (set by orchestrator) */
  memoryAfterMB?: number;
}

export interface PipelineContext {
  workspaceRoot: string;
  graph: KnowledgeGraph;
  filePaths: string[];
  /** Shared file content cache — populated by parse phase, reused by resolve phase (eliminates double I/O) */
  fileCache?: Map<string, string>;
  /** Per-file sorted symbol index for O(1) enclosing-function lookup — built by parse phase */
  fileFunctionIndex?: Map<string, { id: string; startLine: number; endLine: number | undefined }[]>;
  onProgress?: (phase: string, message: string) => void;
  /** Per-phase progress callback — called with (phase, done, total) for each processed item */
  onPhaseProgress?: (phase: string, done: number, total: number) => void;
  verbose?: boolean;
  /** Exclude specific folders from analysis (CLI: --skip-folders) */
  skipFolders?: string[];
  /** Exclude specific files from analysis (CLI: --skip-files) */
  skipFiles?: string[];
  /** Set by parse-phase after execution: which parser was used */
  parserUsed?: 'tree-sitter' | 'regex';
  /** Aggregated semantic fact diagnostics collected during parse. */
  factDiagnostics?: Array<{ code: string; severity: 'info' | 'warning' | 'error'; language: string; affectedCapability: string; impact: 'local' | 'cross-file' | 'repository-wide'; filePath?: string; message?: string; count?: number }>;
  /** Fact schema fingerprint/version for generation compatibility. */
  factSchemaVersion?: string;
  identityFingerprint?: string;
  /** Repository-scoped framework detections reused across phases. */
  frameworkDetections?: FrameworkDetection[];
  /** Semantic facts collected during parse for resolver/index consumers. */
  semanticFacts?: import('../semantic/facts.js').SemanticFact[];
  /** Resolver instrumentation/version for generation compatibility and guards. */
  resolverVersion?: string;
  resolverFingerprint?: string;
  resolutionInstrumentation?: import('../resolution/indexes.js').ResolutionInstrumentation;
  /**
   * v0.4.0 — opt-in summarize phase.
   * Set to true via `--summarize` flag or `analysis.summarizeOnAnalyze: true` config.
   */
  summarize?: boolean;
  /** LLM provider config used by the summarize phase. */
  llmConfig?: LLMConfig;
  /** v1.0.0: when true, orchestrator captures per-phase memory and writes profile.json */
  profile?: boolean;
}

export interface Phase {
  name: string;
  dependencies: string[];
  execute(context: PipelineContext, depResults: Map<string, PhaseResult>): Promise<PhaseResult>;
}
