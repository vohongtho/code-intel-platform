import type { Language } from '../shared/languages.js';
import type { NodeKind } from '../shared/graph-types.js';
import type { SourceRange } from '../semantic/anchors.js';

export interface LanguageIdentityQualifier {
  packagePath?: string;
  modulePath?: string;
  namespace?: string;
  crate?: string;
  assembly?: string;
  visibilityDomain?: string;
}

export interface SymbolIdentityV2 {
  version: 2;
  language: Language;
  kind: NodeKind;
  filePath?: string;
  qualifiedName: string;
  lexicalOwner?: string;
  signatureDiscriminator?: string;
  declarationDiscriminator?: string;
  qualifier?: LanguageIdentityQualifier;
}

export interface DeclarationFragment {
  fragmentId: string;
  symbolId: string;
  filePath: string;
  range: SourceRange;
  partial: boolean;
  hasBody: boolean;
  role: 'primary' | 'partial' | 'forward' | 'merged';
}

export interface CallSiteIdentityV1 {
  version: 1;
  filePath: string;
  callerSymbolId?: string;
  range: SourceRange;
  calleeText: string;
}

export type SymbolSelection =
  | { kind: 'exact'; id: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'missing'; suggestions: string[] };

export type SymbolSelectionById = Extract<SymbolSelection, { kind: 'exact' }>;
export type SymbolSelectionAmbiguous = Extract<SymbolSelection, { kind: 'ambiguous' }>;
export type SymbolSelectionMissing = Extract<SymbolSelection, { kind: 'missing' }>;
