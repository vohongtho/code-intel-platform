/**
 * Refactoring contracts: occurrence categories, per-language rename capability,
 * and the rename plan shape shared by planning, apply and verification.
 *
 * A language being parseable is not proof that a byte-safe rewrite is
 * supported. `apply` is granted per language only where an exact-span adapter
 * (refactoring/edit-spans.ts) and end-to-end verification fixtures exist.
 */
import { Language } from '../shared/languages.js';
import type { AnalysisCoverage } from '../shared/index.js';

export const RENAME_PLAN_SCHEMA_VERSION = 1;

export type OccurrenceCategory = 'exact-definition' | 'exact-semantic' | 'candidate-text' | 'generated' | 'unsupported';

export type OccurrenceRole =
  | 'definition'
  | 'reference'
  | 'import-specifier'
  | 'export-specifier'
  | 'namespace-member'
  | 'string'
  | 'comment'
  | 'property'
  | 'other';

export type RenameCapabilityLevel = 'apply' | 'preview-only' | 'unsupported';

export interface RefactoringCapability {
  language: Language;
  rename: RenameCapabilityLevel;
  /** What `apply` covers when granted; everything outside it is preview-only. */
  scope?: string;
  reason?: string;
}

const PREVIEW_REASON = 'graph references can be listed by line, but no exact-span edit adapter is tested for this language';

/**
 * The published 15-language rename capability matrix. Changing a row to
 * `apply` requires exact-span, transaction and post-analysis verification
 * fixtures for that language.
 */
export const REFACTORING_CAPABILITIES: readonly RefactoringCapability[] = [
  {
    language: Language.TypeScript,
    rename: 'apply',
    scope: 'module-scope declarations (function, class, interface, type alias, enum, top-level const/let/var) and their ES-module imports, re-exports and namespace-member uses in .ts/.mts/.cts files',
    reason: 'members, locals, .tsx (JSX), CommonJS/dynamic imports and declaration merging are preview-only',
  },
  {
    language: Language.JavaScript,
    rename: 'apply',
    scope: 'module-scope declarations and their ES-module imports, re-exports and namespace-member uses in .js/.mjs/.jsx files',
    reason: 'members, locals and CommonJS/dynamic imports are preview-only',
  },
  ...[
    Language.Python, Language.Java, Language.Go, Language.C, Language.Cpp, Language.CSharp, Language.Rust,
    Language.PHP, Language.Kotlin, Language.Ruby, Language.Swift, Language.Dart,
  ].map((language): RefactoringCapability => ({ language, rename: 'preview-only', reason: PREVIEW_REASON })),
  { language: Language.HTML, rename: 'unsupported', reason: 'markup has no renameable symbol declarations' },
];

export function getRefactoringCapability(language: Language | null | undefined): RefactoringCapability {
  return REFACTORING_CAPABILITIES.find((row) => row.language === language)
    ?? { language: language ?? Language.HTML, rename: 'unsupported', reason: 'unknown language' };
}

export interface RenameRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface RenameOccurrence {
  category: OccurrenceCategory;
  role: OccurrenceRole;
  filePath: string;
  range: RenameRange;
  /** UTF-16 offsets into the file text; present only for exact categories. */
  startOffset?: number;
  endOffset?: number;
  text: string;
  reason?: string;
}

export interface RenameEdit {
  filePath: string;
  startOffset: number;
  endOffset: number;
  oldText: string;
  newText: string;
}

export type RenameBoundaryKind =
  | 'ambiguous-target'
  | 'missing-target'
  | 'preview-only-language'
  | 'unsupported-language'
  | 'non-module-scope'
  | 'merged-declaration'
  | 'unsupported-occurrence'
  | 'generated-file'
  | 'graph-reference-not-located'
  | 'name-collision'
  | 'invalid-new-name'
  | 'parse-error'
  | 'scan-limit';

export interface RenameBoundary {
  kind: RenameBoundaryKind;
  message: string;
  filePath?: string;
}

export interface RenameTarget {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine?: number;
  language: Language | null;
}

export interface RenamePlan {
  schemaVersion: typeof RENAME_PLAN_SCHEMA_VERSION;
  /** Fingerprint over target, new name, the edits and every edited file's content (not the index identity). */
  planId: string;
  target: RenameTarget;
  newName: string;
  capability: RefactoringCapability;
  /** True only when every semantic occurrence has an exact, editable span and no boundary blocks apply. */
  applicable: boolean;
  edits: RenameEdit[];
  occurrences: RenameOccurrence[];
  boundaries: RenameBoundary[];
  fingerprint: { indexIdentity: string | null; files: Array<{ filePath: string; sha256: string }> };
  impact: {
    referencingFiles: string[];
    inboundRelationships: number;
    tests: Array<{ testId: string; name: string; filePath: string; kind: string }>;
  };
  expectedDelta: {
    definition: { filePath: string; kind: string; oldName: string; newName: string };
    /** Files whose graph relationships to the target must resolve to the renamed symbol after apply. */
    referenceFiles: string[];
  };
  coverage: AnalysisCoverage;
}

export type SymbolSelectionResult =
  | { status: 'exact'; target: RenameTarget }
  | { status: 'ambiguous'; candidates: RenameTarget[] }
  | { status: 'missing'; candidates: [] };
