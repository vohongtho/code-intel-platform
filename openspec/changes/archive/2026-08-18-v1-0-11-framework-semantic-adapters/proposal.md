# Proposal: Add Auto-Detected Framework Semantic Adapters

## Summary

Model framework-mediated routes, dependency injection, handlers, middleware, events, proxies, and MCP registrations as standard semantic facts consumed by the universal resolver. Do not fork resolver consumers by framework and do not require users to configure the framework manually for common cases.

## Why this belongs after the core resolver

Language-level calls do not capture many real application flows. A controller route decorator, DI container binding, event registration, or MCP tool registration can connect symbols without a direct syntactic call. Competitors have stronger framework-aware extraction in several ecosystems; Code Intel needs the capability to reach practical parity in real services.

## Goals

- Define `FrameworkAdapter` detection/extraction contract.
- Auto-detect frameworks from package/dependency/import/decorator/registration evidence.
- Emit standard `RegistrationFact`, `RouteFact`, dependency-binding, callback/event, and proxy/advice facts.
- Resolve framework facts through the same candidate/evidence/certainty contracts.
- Add adapter ID/version and source-registration evidence to framework relationships.
- Make registration changes participate in incremental invalidation.
- Lazy-load adapters so query-only startup does not pull all framework analysis code.

## Initial priority adapters

1. NestJS
2. Express
3. Fastify
4. ASP.NET Core
5. Microsoft DI
6. Spring MVC/DI selected static registrations
7. FastAPI
8. Flask
9. Django
10. Go HTTP/router patterns
11. Laravel/Symfony
12. Rails
13. MCP SDK tool/resource/prompt registration
14. HTML form/resource/template/embedded-script bindings

Adapters only claim semantics proven by fixtures. Unproven dynamic configuration remains a boundary.

## Scope

### In scope

- Framework adapter/detection registry.
- Static registration/route/DI facts.
- Resolver and incremental integration.
- Evidence/diagnostics.
- Per-adapter corpus and false-positive controls.

### Non-goals

- Executing framework applications.
- Runtime-perfect dependency containers/proxies.
- Copying GitNexus framework implementation.
- User-required framework flags.
- A resolver fork per framework.

## Compatibility

No new mandatory command/config. If no framework is detected, language-level semantics remain unchanged.

## Migration

Framework adapter version/fingerprint participates in semantic compatibility only when its facts contribute to the indexed repository. Relevant version changes may trigger automatic semantic reanalysis.

## Dependencies

Depends on universal semantic facts, evidence-based resolution, and relationship certainty. Dependency-aware incremental integration is required before enabling framework-delta incremental publication.

## Release risk

Medium-high due to false positives. Every adapter needs strong absent-framework and ambiguous-registration negative fixtures.

## Performance impact

Medium during analysis. Detection/index preparation must be generation-scoped, not repeated per call site.

## License/IP

Framework semantics are reimplemented from public framework behavior/docs and repository evidence. GitNexus source/tests/prompts must not be copied.
