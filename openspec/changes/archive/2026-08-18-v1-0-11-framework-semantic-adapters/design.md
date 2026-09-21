# Design: Auto-Detected Framework Semantic Adapters

## Architecture

```ts
interface FrameworkAdapter {
  id: string;
  version: string;
  languages: readonly Language[];
  detect(view: RepositoryFactView): DetectionResult;
  extract(view: RepositoryFactView): FrameworkFactBundle;
}
```

`FrameworkFactBundle` contains only standard semantic facts/diagnostics. It never directly mutates graph consumer behavior.

```text
language facts
  -> framework detection
  -> framework facts
  -> universal resolver strategies
  -> standard relationships + evidence/certainty
  -> existing impact/context/flow consumers
```

## New modules

```text
code-intel/core/src/frameworks/contracts.ts
code-intel/core/src/frameworks/registry.ts
code-intel/core/src/frameworks/detection.ts
code-intel/core/src/frameworks/adapters/<framework>.ts
```

Adapters should be dynamically imported after detection evidence indicates relevance.

## Fact examples

### Route

```ts
interface RouteFact {
  factId: string;
  frameworkId: string;
  method?: string;
  path?: string;
  handlerRef: string;
  registrationRange: SourceRange;
}
```

### Dependency binding

```ts
interface DependencyBindingFact {
  factId: string;
  frameworkId: string;
  contractRef?: string;
  implementationRef?: string;
  lifetime?: string;
  registrationRange: SourceRange;
  dynamic: boolean;
}
```

## Detection

Use multiple evidence sources where available:

- dependency manifest/package names;
- framework imports/usings;
- decorators/attributes/annotations;
- registration-call shapes;
- known config/module files.

One weak string match is insufficient to enable high-confidence framework semantics.

## Initial adapter behaviors

### NestJS

- controller class/method route decorators;
- module providers/imports/controllers;
- constructor injection tokens/types;
- middleware/interceptor/guard registrations where statically explicit.

### Express/Fastify

- router/app method registrations;
- route method/path/handler;
- middleware chains;
- imported handler identity.

### ASP.NET Core/Microsoft DI

- controller/action attributes;
- endpoint mapping calls;
- `Add*`/service-descriptor contract-to-implementation registrations where statically explicit;
- constructor injection/interface dispatch candidates.

### Spring

- controller/request mapping annotations;
- selected bean/component injection facts;
- bounded proxy/advice evidence only where static evidence is explicit. Dynamic runtime container behavior remains boundary.

### Python frameworks

FastAPI/Flask/Django route/view/dependency registrations using explicit decorators/config facts.

### MCP SDK

Map tool/resource/prompt definition/registration/schema to handler functions using package/API call patterns and standard evidence.

## Evidence and certainty

Every framework-derived relationship records adapter ID/version and registration/source evidence. Ambiguous DI providers/routes remain candidate/unknown. Dynamic config never becomes exact only from naming convention.

## Incremental

Registration fact changes invalidate consumers/routes/handlers even when those files are unchanged. Adapter fingerprint/version participates in semantic compatibility.

## Performance

Detection runs once per generation. Prepared fact indexes are shared. No adapter may scan the whole repository per route/call site.

## Alternatives considered

### Hard-code framework logic in `resolve-phase.ts`

Rejected because it mixes framework semantics with language semantics and creates an unmaintainable resolver switch.

### New MCP tools per framework

Rejected because graph quality should improve transparently for existing consumers.

## Failure semantics

Detection uncertain -> do not enable adapter exact semantics. Partial extraction -> diagnostic + candidate/boundary. Adapter error cannot erase base language graph.

## Test strategy

Each adapter requires positive route/DI/handler fixtures, false-positive controls, ambiguous registration, cross-file import handler, performance/index-reuse, and incremental registration-change cases.
