# Proposal: Add an Evidence-Based, Language-Aware Resolution Engine

## Summary

Replace v1.0.10 name-based relationship resolution with a deterministic candidate/evidence engine that consumes semantic facts, prepared workspace indexes, language-specific type/module/dispatch semantics, and explicit boundaries.

The engine has one universal lifecycle and outcome contract. Language adapters provide semantics; framework adapters may later contribute standard registration facts. Users continue using the same analysis and query workflows.

## Production-baseline evidence

`pipeline/phases/resolve-phase.ts` currently builds one global `Map<string,string>` and one per-file `Map<string,string>`. For a call it chooses a same-file name match at confidence 0.95, otherwise one global name match at 0.5. Duplicate names overwrite. `ParsedCall.receiverText` exists, but target selection uses only `call.name`. Imports and heritage are independently extracted from source-line regexes.

## User-visible correctness problem

A same-named function/method in the wrong class/module can become a CALLS edge. Interface/protocol/trait dispatch, overloads, re-exports, generic receivers, aliases, callbacks, and DI/framework registration are materially under-modeled. Blast radius, flows, PR impact, suggested tests, context relations, and dead-code checks inherit those errors.

## Goals

- Resolve from semantic facts rather than source-line regexes.
- Use multi-candidate indexes and evidence-ranked strategies.
- Preserve ambiguity and unsupported/dynamic boundaries.
- Use receiver/type/import/public-surface/owner/signature evidence before simple-name fallback.
- Preserve generic type structure until language semantics are evaluated.
- Model interface/protocol/trait dispatch as bounded candidate sets with completeness metadata.
- Resolve imports against language-defined module/package public surfaces including re-exports.
- Add prepared workspace indexes so hot paths do not scan all files per reference.
- Establish per-language correctness and scalability gates for all 15 registry entries.

## Scope

### Shared strategy families

1. lexical scope
2. import/module/include binding
3. public surface/re-export closure
4. qualified owner
5. `this`/`self`/`super`
6. explicit/inferred receiver type
7. static member/namespace/package
8. constructor binding
9. inheritance/interface/protocol/trait dispatch
10. callback/delegate/function value
11. event/listener registration
12. DI/registration facts
13. bounded signature-compatible fallback
14. unresolved/external/dynamic boundary

Not every language implements every family.

### Non-goals

- Runtime-perfect reflection/eval analysis.
- Whole-program type checker.
- CFG/PDG/taint.
- Public resolver-mode flag or new required command.

## Compatibility

The existing resolve pipeline phase remains the ownership boundary. Existing graph consumers continue to see materialized relationships, with additive trust metadata from the companion certainty proposal.

## Migration

Resolver version/fingerprint becomes part of Generation compatibility. Incompatible old semantic generations rebuild automatically through ordinary analysis.

## Dependencies

Depends on `v1-0-11-fifteen-language-semantic-baseline`, `v1-0-11-universal-semantic-fact-model`, and `v1-0-11-symbol-identity-v2`.

## Release risk

Very high. This is the main semantic replacement. Roll out by language/strategy behind internal compatibility checks, but do not expose a user mode switch. The old resolver may temporarily serve as an explicitly heuristic fallback only where the accepted baseline requires it.

## Performance impact

Medium. Prepared indexes increase generation-scoped memory but reduce repeated workspace scans and enable scalable resolution.

## License/IP

Clean-room implementation for GitNexus-inspired semantic behavior. CodeGraph concepts may be studied under MIT, but prefer original Code Intel contracts and preserve attribution if substantial source is ever reused.
