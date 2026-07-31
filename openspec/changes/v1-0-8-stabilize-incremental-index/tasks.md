# Tasks

- [x] Replace the current multi-artifact publication sequence with generation-based staging.
- [x] Validate graph, BM25, vector and metadata artifacts before publication.
- [x] Publish all required artifacts behind one generation pointer.
- [x] Preserve the previous generation after any graph, BM25, vector or metadata failure.
- [x] Run incremental mutation only against an isolated copy of the live generation.
- [x] Preserve full/incremental graph behavior through the existing incremental suite plus staging-seed coverage.
- [x] Add failure-injection tests that prove failed generation publication does not replace the live pointer.
- [x] Add index trust/freshness status to CLI, HTTP and MCP transports.
- [x] Add migration handling for the existing flat `.code-intel` artifact layout.
- [x] Add artifact-path tests proving graph, BM25, vector and metadata share one staging directory.
- [x] Pass core/web TypeScript builds, the complete core test suite and npm audit gate.

> Completed in `release/1.0.8`. Atomic analysis seeds staging from the current generation, applies incremental work to the isolated copy, and swaps `current.json` only after validation succeeds.
