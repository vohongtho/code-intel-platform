# Design: Universal Semantic Fact Model

## Observed v1.0.10 control flow

```text
source
  -> parsePhase / Tree-sitter query
  -> CodeNode + CodeEdge
  -> resolvePhase
       -> source lines again
       -> regex imports/calls/heritage
       -> more CodeEdge
```

The new internal flow is:

```text
source
  -> Tree-sitter
  -> LanguageFactAdapter
  -> FactBundle
       -> compatibility graph projector
       -> resolution engine
       -> incremental dependency model
       -> future program-analysis lowering
```

`parsePhase` remains the pipeline owner; transport commands are unchanged.

## New modules

```text
code-intel/core/src/semantic/facts.ts
code-intel/core/src/semantic/anchors.ts
code-intel/core/src/semantic/diagnostics.ts
code-intel/core/src/semantic/fact-bundle.ts
code-intel/core/src/semantic/graph-projector.ts
code-intel/core/src/semantic/adapters/adapter.ts
code-intel/core/src/semantic/adapters/<language>.ts
```

## Core contracts

```ts
interface SemanticAnchors {
  identity: SourceRange;
  scope?: SourceRange;
  documentation?: SourceRange;
  render: SourceRange;
}

interface DeclarationFact {
  factId: string;
  language: Language;
  filePath: string;
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

interface DeclarationFragment {
  fragmentId: string;
  declarationRef: string;
  filePath: string;
  range: SourceRange;
  partial: boolean;
  hasBody: boolean;
}

interface ImportBindingFact {
  factId: string;
  sourceModule: string;
  importedName?: string;
  localName: string;
  bindingKind: 'named' | 'alias' | 'namespace' | 'wildcard' | 'include';
  scopeRef?: string;
  sourceRange: SourceRange;
}

interface PublishedNameFact {
  factId: string;
  moduleRef: string;
  publicName: string;
  sourceRef: string;
  publicationKind: 'definition' | 'reexport' | 'wildcard' | 'language-implicit';
  sourceRange: SourceRange;
}

interface CallSiteFact {
  factId: string;
  callerRef?: string;
  calleeText: string;
  receiver?: ReceiverFact;
  arguments?: readonly ArgumentShapeFact[];
  sourceRange: SourceRange;
}

interface ReferenceFact {
  factId: string;
  operation: 'read' | 'write' | 'call' | 'instantiate' | 'type-use';
  targetText: string;
  receiver?: ReceiverFact;
  sourceRange: SourceRange;
}
```

## Type references

`TypeReferenceFact` must preserve structure instead of flattening to a string too early:

```ts
type TypeReferenceKind =
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
```

Language-specific metadata can retain package/module/crate semantics until a resolver strategy consumes it.

## Semantic kind traits

Avoid scattered hard-coded checks such as `class || struct`:

```ts
interface SemanticKindTraits {
  declaresMembers: boolean;
  nominalType: boolean;
  structuralShape: boolean;
  canImplementInterface: boolean;
  canReceiveDispatch: boolean;
  participatesInInheritance: boolean;
}
```

This supports records, structs, protocols, structural shapes, unions, and future type forms through semantics rather than consumer-specific `NodeKind` lists.

## Semantic anchors

Identity, scope, documentation, and rendering do not always share one AST node. Grouped Go type declarations, multi-variable declarations, exported wrappers, and documentation comments require explicit anchors. The adapter selects the smallest syntax node representing exactly one semantic entity for identity.

## Diagnostics

```ts
interface FactDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  language: Language;
  filePath?: string;
  affectedCapability: string;
  impact: 'local' | 'cross-file' | 'repository-wide';
  sourceRange?: SourceRange;
}
```

Cross-file-affecting losses such as unresolved owner/module identity may not be silently ignored.

## Compatibility graph projector

`graph-projector.ts` converts facts to the existing `CodeNode`/basic structural-edge shape. During rollout each language runs old extraction and fact projection against the corpus; accepted normalized semantics must match unless the change is explicitly correcting a bug with negative evidence.

## Storage

Do not persist every fact as a graph node. Facts needed for incremental invalidation/evidence may be persisted in a compact versioned side artifact later. The initial implementation can keep analysis-generation facts in memory while identity/resolver work is developed.

## Alternatives considered

### Enhance `resolve-phase.ts` regexes directly

Rejected because parsing and resolution would remain divergent and every new language/framework rule would duplicate source interpretation.

### Replace all parser code at once

Rejected. Migration is adapter-by-adapter under the 15-language corpus.

## Failure semantics

An adapter may produce partial facts and diagnostics. It may not fabricate exact relationships to hide unsupported syntax. If the fact path cannot meet an accepted language baseline, that language retains the safe legacy compatibility projection until corrected.

## Test strategy

- fact contract serialization/determinism;
- adapter golden facts per language;
- grouped declaration/semantic-anchor cases;
- import binding vs public publication cases;
- structured generic type cases;
- property/read/write/type-use cases;
- diagnostics for unsupported cross-file semantics;
- old graph vs compatibility projection normalized comparison.
