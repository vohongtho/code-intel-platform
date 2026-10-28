# Parser dependency audit and scaling evidence

Recorded 2026-10-28 on `release/1.0.12`.

## GraphQL: `graphql@^16.14.2` added as a direct production dependency

Added to `code-intel/core/package.json` with `npm install graphql@^16.14.2 --workspace=code-intel/core`. The lockfile gained one entry (`node_modules/graphql` 16.14.2) and nothing else.

- License: MIT (`npm view graphql license`, and the lockfile `license` field).
- Runtime dependencies: none.
- Published 2026-06-09, more than four months before adoption.
- Engines: `^12.22.0 || ^14.16.0 || ^16.0.0 || >=17.0.0`. This covers the product's `node >=22.0.0`.
- Why not 17.x: `graphql@17.0.2` declares `^22 || ^24 || ^25 || >=26` and would warn (EBADENGINE) on Node 23, which our `>=22.0.0` range still allows.
- Packaging: tsup leaves `package.json` `dependencies` external by default (and the library entry uses `bundle: false`), so `dist/` imports `graphql` from `node_modules` at runtime like the other dependencies; npm installs it with the package. The runtime SBOM picks up its license from `node_modules`; no allowlist change was needed. `verify:runtime-bundle-integrity` and `verify:packaged-smoke-matrix` both pass with it installed; the smoke matrix runs the packaged CLI, MCP and HTTP server.
- Advisories: `npm audit --omit=dev` reports nothing for `graphql`. The same run reports 18 advisories (1 critical, 11 high, 6 moderate) in packages that were already installed before this change: `proxy-addr`, `@modelcontextprotocol/sdk`, `@huggingface/transformers`, `compression`, `minimatch`, `@grpc/grpc-js`, `body-parser` and others. Those are out of scope for this change and are not caused by it.
- Untrusted input: we call only `parse(source, { maxTokens })` and `print`. No schema is built or executed, and introspection is never run. File size and token count are capped before and during parsing (see `GRAPHQL_LIMITS`).

The dependency is never reached through hoisting: `graphql` was not installed anywhere in the tree before this change.

## Protobuf: in-repository parser, no dependency

`protobufjs` is present only as a transitive `8.7.1` install that `npm ls` marks invalid (`onnxruntime-web` wants `^7.2.4`, `@grpc/proto-loader` wants `^7.5.5`). Pinning a direct copy would either pick a side in that conflict or add a second copy. `protobufjs` also has prior prototype-pollution advisories (CVE-2022-25878, CVE-2023-36665).

The contract subset we need is small: syntax/edition, package, imports, messages with numbers, cardinality, map and oneof, enums, reserved ranges and names, and services with streaming. `multi-repo/schema-parsers/proto-model.ts` implements it as a bounded recursive-descent parser in about 630 lines, including cross-file type resolution. It has no code generation, skips options without evaluating them, and caps file size, tokens, nesting depth and definitions per file (`PROTO_LIMITS`). Extensions and proto2 groups are skipped with an explicit coverage boundary. Unlike `protobufjs`, it never resolves `import` paths from disk; types resolve only against the files already parsed from the repository.

## Scaling benchmark

`tests/unit/multi-repo/protocol-scaling.test.ts`, single run on the development machine (WSL2), one process:

| Step | Input | Time |
| --- | --- | --- |
| Parse GraphQL schema | 1,501 types × 12 fields with args/defaults | 255 ms |
| Extract operations | 1,500 named operations, 3 levels deep | 73 ms |
| Map operations | 1,500 operations × 3 schemas | 21 ms |
| Build base + head contracts | the schema above plus 800 messages × 15 fields and 200 RPCs, twice | 688 ms |
| Compare changed contracts | 2,302 contracts, fingerprint-unchanged ones skipped | 4.5 ms |
| Type cap | 5,010 scalars | 6 ms, capped at 5,000 with `type-count-limit` |
| Definition cap | 5,001 messages | 5 ms, rejected with `definition-limit` |

The matcher caches one type/field index per schema object, so mapping is linear in operations × schemas × selected fields. The test asserts generous ceilings (20 s / 30 s / 10 s) to catch quadratic regressions, not to pin these numbers. Timings on CI hardware are unmeasured.
