import type { Language } from '../shared/languages.js';
import type { SemanticAnchors, SourceRange } from './anchors.js';
import type {
  HttpConsumerFact,
  HttpRequestShapeFact,
  HttpResponseShapeFact,
  HttpRouteFact,
} from './api-contracts/types.js';

export type FactId = string;
export type SemanticCapability =
  | 'definitions'
  | 'ownership'
  | 'imports'
  | 'exports'
  | 'calls'
  | 'references'
  | 'heritage'
  | 'type-hints'
  | 'registrations'
  | 'routes'
  | 'embedded-languages';

export interface SemanticKindTraits {
  declaresMembers: boolean;
  nominalType: boolean;
  structuralShape: boolean;
  canImplementInterface: boolean;
  canReceiveDispatch: boolean;
  participatesInInheritance: boolean;
}

export interface SignatureParameterFact {
  name: string;
  type?: TypeReferenceFact;
  optional?: boolean;
  variadic?: boolean;
}

export interface SignatureFact {
  parameters: readonly SignatureParameterFact[];
  returnType?: TypeReferenceFact;
}

export interface VisibilityFact {
  level: 'public' | 'protected' | 'private' | 'internal' | 'package' | 'local' | 'unknown';
}

export interface ReceiverFact {
  text: string;
  type?: TypeReferenceFact;
}

export interface ArgumentShapeFact {
  position: number;
  label?: string;
  text?: string;
  spread?: boolean;
}

export type TypeReferenceKind =
  | 'nominal'
  | 'generic-application'
  | 'type-parameter'
  | 'container'
  | 'union'
  | 'callable'
  | 'pointer'
  | 'reference'
  | 'specialization'
  | 'unknown';

export interface TypeReferenceFact {
  kind: TypeReferenceKind;
  text: string;
  name?: string;
  namespace?: string;
  elements?: readonly TypeReferenceFact[];
  arguments?: readonly TypeReferenceFact[];
  parameterTypes?: readonly TypeReferenceFact[];
  returnType?: TypeReferenceFact;
  target?: TypeReferenceFact;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface FrameworkEvidenceFact {
  frameworkId: string;
  adapterVersion: string;
  registrationRef?: string;
  registrationText?: string;
  exact: boolean;
}

interface FactBase {
  factId: FactId;
  language: Language;
  filePath: string;
  sourceRange: SourceRange;
  frameworkEvidence?: FrameworkEvidenceFact;
}

export interface DeclarationFact extends FactBase {
  declarationKind: string;
  name: string;
  qualifiedName?: string;
  ownerRef?: string;
  anchors: SemanticAnchors;
  signature?: SignatureFact;
  visibility?: VisibilityFact;
  type?: TypeReferenceFact;
  traits?: SemanticKindTraits;
}

export interface DeclarationFragmentFact extends FactBase {
  declarationRef: FactId;
  fragmentId: string;
  range: SourceRange;
  partial: boolean;
  hasBody: boolean;
}

export interface ImportBindingFact extends FactBase {
  sourceModule: string;
  importedName?: string;
  localName: string;
  bindingKind: 'named' | 'alias' | 'namespace' | 'wildcard' | 'include';
  scopeRef?: string;
}

export interface PublishedNameFact extends FactBase {
  moduleRef: string;
  publicName: string;
  sourceRef: string;
  publicationKind: 'definition' | 'reexport' | 'wildcard' | 'language-implicit';
}

export interface CallSiteFact extends FactBase {
  callerRef?: string;
  calleeText: string;
  receiver?: ReceiverFact;
  arguments?: readonly ArgumentShapeFact[];
}

export interface ReferenceFact extends FactBase {
  operation: 'read' | 'write' | 'call' | 'instantiate' | 'type-use';
  targetText: string;
  receiver?: ReceiverFact;
}

export interface HeritageFact extends FactBase {
  declarationRef?: string;
  heritageKind: 'extends' | 'implements' | 'mixes-in';
  target: TypeReferenceFact;
}

export interface RegistrationFact extends FactBase {
  registrationKind: string;
  subjectRef?: string;
  targetText: string;
  framework?: string;
}

export interface DependencyBindingFact extends FactBase {
  bindingKind: 'contract-to-implementation' | 'token-to-provider' | 'factory' | 'instance' | 'unknown';
  contractRef?: string;
  implementationRef?: string;
  tokenText?: string;
  lifetime?: string;
  dynamic?: boolean;
  framework?: string;
}

export interface RouteFact extends FactBase {
  routeKind: 'http' | 'rpc' | 'event' | 'cli' | 'other';
  path: string;
  method?: string;
  handlerRef?: string;
  framework?: string;
}

export interface EmbeddedRegionFact extends FactBase {
  embeddedLanguage: string;
  hostLanguage: Language;
  extractionKind: 'literal' | 'template' | 'block' | 'attribute' | 'unknown';
  contentRange: SourceRange;
}

export type SemanticFact =
  | DeclarationFact
  | DeclarationFragmentFact
  | ImportBindingFact
  | PublishedNameFact
  | CallSiteFact
  | ReferenceFact
  | HeritageFact
  | RegistrationFact
  | DependencyBindingFact
  | RouteFact
  | EmbeddedRegionFact
  | HttpRouteFact
  | HttpRequestShapeFact
  | HttpResponseShapeFact
  | HttpConsumerFact;
