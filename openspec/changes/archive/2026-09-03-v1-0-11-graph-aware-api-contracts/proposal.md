# Proposal: Graph-Aware API Contracts

## Summary

Extend existing route discovery and graph analysis with normalized HTTP producer and consumer contract facts so Code Intel can answer route-level compatibility and impact questions without replacing existing `routes`, `blast_radius`, `pr_impact`, `context`, or repository-group workflows.

## Production-baseline evidence

The platform already discovers routes, maps source symbols into the graph, performs impact analysis, and extracts cross-repository route/schema contracts. What is missing is a normalized contract connecting an HTTP producer to request/response semantics and statically identifiable consumers. Existing graph edges therefore cannot reliably answer whether a backend response-field change breaks frontend code or whether an HTTP method/path change invalidates a known caller.

## User-visible problem

A developer changing an API can see the changed handler and general blast radius but cannot ask one evidence-backed question such as: which consumers read the removed field, which repositories are affected, which flows depend on the route, and is the change statically compatible?

## Goals

- Introduce universal `RouteContractFact`, `ApiShapeFact`, and `ApiConsumerFact` contracts.
- Capture HTTP method, normalized path, handler identity, route parameters, middleware/auth evidence, request shape, response variants/statuses, and response keys when statically knowable.
- Capture statically knowable consumers from `fetch`, Axios, Angular HttpClient, and framework-generated/typed clients where supported.
- Resolve consumers to producers using method + normalized route evidence, not URL substring matching alone.
- Persist additive graph relationships and compact contract metadata with certainty/coverage.
- Add specialized `api_contract`, `api_impact`, and `api_drift` MCP/HTTP capabilities while reusing the existing graph, identity, evidence, and context layers.
- Integrate API impact into existing `pr_impact` output when API contract changes are detected.

## Scope

### In scope

- Express/Fastify and NestJS producer adapters first.
- ASP.NET Core producer adapter as the next typed backend target.
- Fetch/Axios/Angular HttpClient consumer extraction.
- Static request/response object-key extraction and references to named DTO/schema symbols.
- Route normalization for literal segments, named parameters, controller prefixes, and nested routers where statically resolvable.
- Compatibility classification: compatible, potentially-breaking, breaking, unknown.
- Relationship evidence and incomplete-analysis boundaries.
- Incremental invalidation by changed route/consumer/shape facts.

### Non-goals

- Runtime traffic tracing.
- Full OpenAPI generation or replacement of OpenAPI tooling.
- Proving compatibility for fully dynamic URLs, reflection-generated routes, arbitrary serializers, or runtime-only schema transforms.
- Duplicating general blast-radius/path traversal tools.
- Supporting every web framework in the first release.

## Compatibility

Existing route nodes, MCP tools, HTTP routes, graph queries, and repository-group contracts remain valid. New fields and tools are additive. Existing route extraction should feed the new fact model rather than be forked into a second independent scanner.

## Dependencies

Depends on `v1-0-11-universal-semantic-fact-model`, `v1-0-11-symbol-identity-v2`, `v1-0-11-evidence-based-resolution`, `v1-0-11-relationship-certainty`, and framework adapters where applicable.

## Migration

Generation V2 metadata receives an API-contract artifact/schema fingerprint. Legacy generations may expose existing routes but MUST report API contract coverage as unavailable rather than fabricating compatibility.

## Release risk

Medium-high. Route normalization and shape inference are framework-sensitive. False-positive producer/consumer links are more harmful than unresolved links, so matching must remain conservative.

## Performance impact

Moderate during analysis; low at query time. Facts must be indexed by normalized method/path and canonical symbol IDs. Dynamic URL expressions must not trigger unbounded candidate expansion.

## License/IP

Original implementation. Do not copy GitNexus noncommercial source, tests, schemas, prompts, or implementation expression. Framework behavior may be implemented from public framework documentation and independent fixtures.
