# Design: Symbol Identity v2 and Declaration Fragments

## Observed v1.0.10 identity flow

```text
Tree-sitter capture
  -> name
  -> dedupe `${kind}:${name}`
  -> generateNodeId(kind, file, name)
  -> string `kind:file:name`
```

Relationships use:

```text
generateEdgeId(source, target, kind)
  -> `kind:source->target`
```

This assumes one semantic symbol per kind/name/file and one semantic relation per source-target-kind pair.

## New modules

```text
code-intel/core/src/identity/contracts.ts
code-intel/core/src/identity/normalization.ts
code-intel/core/src/identity/symbol-identity.ts
code-intel/core/src/identity/callsite-identity.ts
code-intel/core/src/identity/selector-index.ts
code-intel/core/src/identity/legacy-alias.ts
```

`graph/id-generator.ts` remains a compatibility facade during migration and delegates to versioned helpers where enough semantic facts exist.

## Contracts

```ts
interface LanguageIdentityQualifier {
  packagePath?: string;
  modulePath?: string;
  namespace?: string;
  crate?: string;
  assembly?: string;
  visibilityDomain?: string;
}

interface SymbolIdentityV2 {
  version: 2;
  language: Language;
  kind: string;
  filePath?: string;
  qualifiedName: string;
  lexicalOwner?: string;
  signatureDiscriminator?: string;
  declarationDiscriminator?: string;
  qualifier?: LanguageIdentityQualifier;
}

interface DeclarationFragment {
  fragmentId: string;
  symbolId: string;
  filePath: string;
  range: SourceRange;
  partial: boolean;
  hasBody: boolean;
  role: 'primary' | 'partial' | 'forward' | 'merged';
}

interface CallSiteIdentityV1 {
  version: 1;
  filePath: string;
  callerSymbolId?: string;
  range: SourceRange;
  calleeText: string;
}
```

## Canonical ID format

Use deterministic hashes over normalized semantic payloads:

```text
sym:v2:<kind>:<hash>
frag:v1:<hash>
callsite:v1:<hash>
edge:v2:<kind>:<callsite-or-source-hash>:<target-hash>
```

The hash input must use repository-relative slash-normalized paths, normalized owners/signatures, and stable key ordering. Body content, docs, decorators, and line endings must not participate unless they are semantic identity discriminators.

## Language identity qualifiers

The semantic fact adapter provides namespace/package/module/crate/visibility information. Examples:

- Go: package path matters for unexported method identity.
- Java/Kotlin: package + declaring type.
- C#: namespace + declaring type/assembly context where available.
- Rust: crate/module visibility domain.
- Python: module path + lexical owner.
- C/C++: namespace/translation-unit/linkage qualifier where statically known.

A generic identity algorithm consumes these qualifiers; language adapters own their semantics.

## Declaration fragments

One canonical symbol may collect multiple fragments. The merge layer must preserve all source locations and define field ownership deterministically.

Examples:

- C# partial class/record.
- TypeScript declaration merging.
- C/C++ forward declaration plus definition.
- Reopened namespace/module forms.

Do not use source order to discard fragments. Prefer body-bearing definition for implementation content while retaining declaration docs/metadata according to language merge rules.

## Call-site identity

Every `CallSiteFact` gets a stable identity from file/range/caller/callee spelling. Two calls on different ranges produce different IDs even if they resolve to the same target. Relationship storage can therefore attach evidence to both call sites.

## Selector index

```ts
interface SymbolSelectorIndex {
  byId: Map<string, CodeNode>;
  byQualifiedName: Map<string, readonly string[]>;
  bySimpleName: Map<string, readonly string[]>;
  byOwner: Map<string, readonly string[]>;
  byLegacyId: Map<string, readonly string[]>;
}
```

All candidate lists are deterministically sorted. Existing `find by name` helpers should migrate to a shared result union:

```ts
type SymbolSelection =
  | { kind: 'exact'; id: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'missing'; suggestions: string[] };
```

## Storage changes

Prefer compact first-class columns for identity version/qualified owner if frequently queried, while keeping rich details in metadata/side evidence. Relationship persistence must add call-site identity before repeated calls can remain distinct after reload.

Every affected path must be updated together: shared graph types, `storage/schema.ts`, bulk/CSV writers, LadybugDB loader, export/import, multi-repo graph loading, tests.

## Migration and Generation V2

Add `identityFingerprint` to semantic compatibility. A v1.0.10 generation without identity v2 can remain readable for legacy querying, but any analysis that requires v2 semantics automatically stages a full rebuild. Never mutate old published IDs in place.

## Alternatives considered

### Add start line to the current string ID

Rejected. It distinguishes overloads but causes identity churn when declarations move by unrelated edits and does not represent partial/merged symbols.

### Use only qualified name

Rejected. Signatures/visibility domains and local/nested collisions still need discrimination.

## Failure semantics

If an adapter cannot produce a safe discriminator, identity may use a deterministic declaration fragment discriminator and mark semantic completeness partial. It must not silently merge two known distinct declarations.

## Test strategy

- overloads and constructor overloads;
- nested declarations and same-name locals;
- same name in separate owners/namespaces/modules;
- partial/merged/forward declarations;
- body-only edit stability;
- declaration signature change behavior;
- repeated call-site preservation;
- persistence/reopen;
- legacy selector exact/ambiguous behavior;
- serial/parallel deterministic IDs.
