# Tasks

- [x] Reuse shared unified-diff parsing outside the legacy MCP switch.
- [x] Add a shared change-context service that combines changed files, changed symbols, blast radius and suggested tests.
- [x] Add a `change_context` MCP transport with compact JSON output.
- [x] Add HTTP and CLI transports using the same shared service.
- [x] Add deterministic tests for changed paths, normalization, empty graphs and bounded output.
- [x] Enforce the context token budget on generated change packs.
- [x] Document compatibility with `detect_changes`, `pr_impact` and `suggest_tests`.
- [x] Publish an OpenAPI 3.1 contract from the dedicated HTTP transport.
- [x] Add web-facing TypeScript request/response contracts.
- [x] Pass core/web TypeScript builds, the complete core test suite and npm audit gate.

> Completed in `release/1.0.8`. CLI, HTTP and MCP transports delegate to the same `buildChangeContext()` service.
