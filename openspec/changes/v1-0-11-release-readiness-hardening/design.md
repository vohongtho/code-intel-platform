# Design: v1.0.11 Release Readiness and Hardening

## Design intent

This change does not add a new product subsystem. It defines the release architecture and validation boundary for `v1.0.11` so that the release is proven from a clean checkout through published artifacts.

The release pipeline is treated as a product path in its own right:

```text
clean source checkout
  -> dependency install
  -> explicit product build
  -> semantic correctness gates
  -> compatibility gates
  -> package/runtime/container assembly
  -> package-content verification
  -> release-candidate evidence
  -> tag
  -> publish
  -> downloaded-artifact smoke tests
```

The governing invariant is:

```text
OpenSpec == source behavior == tests == docs == packaged artifacts == published artifacts
```

## Current release-path findings that this design must address

### Build ordering is not expressed consistently

`code-intel/core/package.json` currently has a `build` script that builds Shared and Core, while the Core build copies Web assets. The `test` script explicitly builds Web before Core, which means a workflow that runs tests first can leave `code-intel/web/dist` present and accidentally make a later Core build pass.

`.github/workflows/release-validate.yml` currently runs:

```text
Typecheck
-> Unit tests
-> Build core dist
```

Because the unit-test script builds Web first, this does not prove that the release build has a correct explicit Web -> Core dependency order.

The release design MUST make the product build graph explicit and independent of test side effects.

### Two release-readiness workflows exist with different maturity

The repository currently contains both:

```text
.github/workflows/release-readiness.yml
.github/workflows/release-validate.yml
```

`release-readiness.yml` still contains `1.0.10` version assertions and older build assumptions. `release-validate.yml` targets `release/**` and is closer to the required `1.0.11` path, but still inherits the test-before-Core-build artifact-order issue.

The implementation SHOULD converge release validation onto one authoritative path or make the division of responsibilities explicit. Stale `1.0.10` release assertions MUST NOT remain an active `1.0.11` release gate.

### Publication validation occurs too late if only tag-triggered

`.github/workflows/publish.yml` is tag-triggered. Publication validation may remain there, but the same release-critical correctness checks MUST be runnable before the release tag is created.

### Package version is already 1.0.11

`code-intel/core/package.json` is already `1.0.11`. Release validation therefore MUST check consistency among package metadata, lock metadata, CLI output and final artifact metadata rather than assuming an old hard-coded version.

### Documentation is part of the release contract

`README.md` currently exposes `npm-v1.0.11` in a static badge even before public publication and contains broad feature claims that must be reconciled against exact `1.0.11` maturity. `CHANGELOG.md` must use the real publication date and distinguish synthetic graph-diff scaling tests from full end-to-end repository analysis benchmarks.

## Build architecture

### Authoritative product build

Define one explicit product-build orchestration path. The implementation may use npm workspaces, root scripts, or a dedicated release build script, but the dependency order MUST be represented directly.

Conceptually:

```text
build shared
build web
build core/package
validate core dist
```

The final implementation SHOULD minimize duplicated build-order knowledge across:

- root `package.json`
- `code-intel/core/package.json`
- Dockerfile/build scripts
- `.github/workflows/release-validate.yml`
- `.github/workflows/publish.yml`
- `scripts/distribution/*`

The release path MUST be reproducible after deleting all generated outputs.

### Clean build precondition

A clean-build gate MUST remove generated artifacts before release assembly. The gate MUST prove that no required runtime asset is inherited from a previous test/build step.

At minimum validate absence/recreation of:

```text
code-intel/web/dist
code-intel/core/dist
code-intel/core/dist-tests
dist/runtime-bundles
```

where relevant to the selected build command.

## Release validation architecture

### Authoritative pre-release workflow

The preferred pre-release workflow is `.github/workflows/release-validate.yml` because it already triggers on `release/**`.

Required trigger support:

```yaml
push:
  branches:
    - 'release/**'
workflow_dispatch:
```

`workflow_dispatch` is required so the exact candidate SHA can be revalidated intentionally without creating a tag.

If `release-readiness.yml` remains, one of the following MUST be true:

1. it is updated to `1.0.11` and has a clearly separate purpose, or
2. it is retired/disabled from release gating, or
3. its responsibilities are folded into `release-validate.yml`.

Two active release workflows MUST NOT disagree on version, build path or required gates.

### Release evidence

A release validation run MUST make the following facts observable:

```text
commit SHA
package version
Node version
runner OS/architecture
npm package hash
runtime archive hashes
Docker image/archive digest where applicable
```

The implementation may emit a JSON/Markdown release-evidence artifact or use job summaries plus artifact metadata. The important property is that evidence can be tied to one exact SHA.

### Release-candidate rule

Tagging is allowed only when:

```text
HEAD == validated RC SHA
```

Any post-validation commit invalidates that evidence and requires a new complete release-validation run.

## Semantic convergence architecture

### Canonical comparison

Release tests MUST compare normalized semantic state, not only node/edge counts.

Create or reuse a canonicalization helper for release convergence tests that:

- sorts nodes by canonical ID;
- sorts relationships by stable relationship identity/call-site identity;
- removes volatile timestamps/local paths;
- preserves semantic properties including certainty, strategy and evidence identity;
- includes API-contract-relevant semantic state where applicable;
- includes artifact fingerprints needed to prove producer compatibility;
- includes program-analysis artifact identity/summaries where applicable and deterministic.

Prefer reusing existing semantic snapshot/diff normalizers and Generation verification helpers instead of creating an unrelated third normalization model.

### Cold/cached/forced convergence

For one unchanged source revision, validate:

```text
cold analysis == no-op/cached state == forced rebuild
```

The comparison MUST be semantic and persisted-state aware.

### Incremental/full convergence

The current user-facing correctness model remains conservative: non-empty changes may cause a full graph rebuild even though dependency-aware planning infrastructure exists. Release tests MUST describe the path truthfully.

If any production path actually executes an incremental semantic update, its final output MUST equal an independently built full result.

If no surgical incremental executor is active for a scenario, the test MUST NOT claim incremental execution; it SHOULD instead prove that the current change-detection/rebuild path converges exactly to forced full analysis.

This distinction prevents release documentation from presenting planning/foundation code as an activated production executor.

### Mutation matrix

Convergence fixtures SHOULD cover:

```text
body edit
add/delete symbol
rename/move symbol
move file
import/export change
same-simple-name/overload ambiguity
inheritance/interface change
route method/path change
request/response shape change
consumer change
```

Unsupported scenarios must be recorded explicitly instead of fabricated as passing coverage.

## Cache and producer-fingerprint architecture

Semantic cache validity MUST be a function of both source content and semantic producer identity.

The release gate MUST prove invalidation when producer semantics change while source bytes remain unchanged.

Relevant producer identities include, where represented by current architecture:

```text
parser/grammar fingerprint
extraction/fact-schema fingerprint
Symbol Identity version/fingerprint
resolver version/fingerprint
evidence schema/fingerprint
framework adapter fingerprint
API contract schema/fingerprint
program-analysis version
language lowering version
semantic graph fingerprint
```

Derived artifacts MUST either include equivalent compatibility inputs or be invalidated by the owning Generation compatibility decision.

The release tests SHOULD mutate test-only fingerprint inputs/contracts rather than editing production version constants purely to force a test.

## Backward-compatibility architecture

### 1.0.10 fixture

The compatibility suite SHOULD use an actual `1.0.10` installed/package state where practical, not a hand-written imitation of its metadata.

Fixture preparation should cover representative persisted state:

```text
repo registration
Generation/index artifacts
configuration
repository group
agent target selection
optional embedding metadata where practical
```

The candidate `1.0.11` runtime/package is then installed over or used against that state.

### Compatibility decision

Old semantic artifacts MUST end in exactly one of these states:

```text
compatible and reused with proof
incompatible and reanalyzed/rebuilt
rejected with actionable recovery
```

They MUST NOT be silently treated as trusted/fresh if identity/resolver/evidence/schema compatibility is missing.

### Rollback

Rollback tests MUST distinguish runtime rollback from data-schema compatibility. If `1.0.10` cannot safely consume an index created by `1.0.11`, the runtime must fail closed or instruct reanalysis rather than serving misleading results.

User-owned data/config must be preserved according to the existing runtime lifecycle contract.

## Program-analysis release architecture

### Single source of truth for capability state

`code-intel/core/src/program-analysis/languages/*` capability registry and real parse/integration tests are authoritative. README, CHANGELOG and release notes derive their numbers/status from that evidence.

A `supported` language MUST have the repository's defined proof (real grammar parse + relevant passing integration tests). `partial` MUST not be presented as fully supported.

### Public maturity boundary

Internal modules may implement IR, CFG, data flow, PDG and taint while public query surfaces expose only a subset. Release docs MUST separate:

```text
engine capability
public integration
maturity/coverage
```

No documentation may imply a full public advanced-analysis explorer if that surface is not implemented and tested.

### Resource limits

Program-analysis truncation/resource boundaries MUST remain explicit. A limit hit cannot be transformed into a complete/safe result by CLI/MCP/HTTP presentation code.

## Truncation and coverage architecture

Bounded result surfaces SHOULD converge on shared result semantics when possible:

```ts
interface BoundedResultMetadata {
  returned: number;
  totalKnown?: number;
  truncated: boolean;
}
```

Do not add this shape mechanically to every endpoint if an existing pagination contract already expresses equivalent information such as `total`/`hasMore`. The requirement is semantic consistency, not one forced JSON property vocabulary.

Review surfaces including:

- search;
- file/symbol lists;
- blast radius;
- paths;
- graph diff;
- API consumers;
- cross-repo consumer expansion;
- context;
- PR impact;
- program-analysis outputs.

Where an existing contract uses `limit`, `total`, `hasMore`, `coverage`, or `truncated`, preserve backward compatibility and ensure agents can distinguish lower bounds from exhaustive proof.

## Package and artifact validation

### npm tarball

The npm pack gate MUST inspect the actual tarball, not merely run `npm pack` and delete it.

Validate required assets and forbidden accidental contents. Install the tarball into a temporary clean project and run packaged CLI smoke tests.

### Runtime bundles

For each supported target validate:

```text
archive exists
archive structure valid
launcher executable/usable
runtime manifest valid
.sha256 matches archive
SBOM exists and parses
provenance sidecar exists and references correct target/version
```

Cross-platform bundles may be structurally validated on Linux where execution is impossible; at least the host-compatible bundle SHOULD be executed in CI.

### Docker

Build with no host dist dependency. Run/pull the built image and verify version/startup before publication where feasible.

### Post-publish artifacts

After tag publication, smoke tests MUST consume downloaded/pulled artifacts rather than workspace binaries:

```text
npm registry package
GHCR image
runtime archive/GitHub release artifact
```

## Security and licensing architecture

Keep existing gates for:

```text
npm production audit
license compatibility audit
Trivy image scan
cosign/provenance
runtime SHA/SBOM/provenance
```

Release validation SHOULD avoid masking audit failures as registry timeouts after all retries. The final job status must preserve the actual non-zero result.

Dependency-license checks MUST include runtime dependencies actually shipped in npm/runtime bundles. GitNexus-derived implementation ideas remain clean-room and are not a direct source-code dependency for this release.

## Documentation architecture

### README.md

Mandatory release-hardening output:

- truthful npm version/badge state;
- architecture updated for semantic facts -> identity -> evidence resolution -> evidence graph;
- Program Analysis Foundation section and language capability matrix;
- clear current incremental behavior;
- runtime lifecycle documentation aligned to packaged commands;
- no benchmark claim stronger than the tests prove.

### CHANGELOG.md

Mandatory output:

- real publication date only at actual release;
- Program Analysis Foundation entry;
- explicit maturity/limitations;
- graph-diff scaling wording that distinguishes synthetic normalized-graph benchmark from full end-to-end snapshot analysis;
- compatibility/reindex/upgrade notes where users need them.

README and CHANGELOG updates are mandatory tasks in this OpenSpec change and cannot be deferred as optional documentation cleanup.

## Snapshot/diff performance metrics

The current snapshot/diff instrumentation measures per-phase `durationMs` and parent-process `rssDeltaBytes`.

Because the `analysis` phase invokes a child process, parent RSS delta is not analyzer peak RSS. Documentation/tests MUST preserve this measurement boundary.

A future enhancement may collect child peak RSS explicitly, but it is not required for the `1.0.11` release unless a current claim incorrectly promises analyzer peak memory.

## Failure policy

Release validation is fail-closed for correctness-sensitive gates.

A release cannot proceed when:

- build outcome depends on stale artifacts;
- exact SHA has no green validation;
- semantic convergence fails;
- incompatible old indexes are trusted silently;
- package/runtime assets are missing;
- version/capability documentation contradicts tested source behavior;
- unaccepted high/critical production vulnerabilities exist;
- required provenance/checksum/signature generation fails;
- upgrade/rollback corrupts user state.

Non-blocking performance improvements, new integrations and feature expansions are moved to later releases.

## Implementation boundaries

Expected files/modules to inspect or modify include, but are not limited to:

```text
.github/workflows/release-validate.yml
.github/workflows/release-readiness.yml
.github/workflows/publish.yml
package.json
package-lock.json
code-intel/core/package.json
code-intel/web/package.json
Dockerfile / Docker build files
scripts/distribution/*
code-intel/core/src/storage/index-generation.ts
code-intel/core/src/pipeline/compatibility-receipt.ts
code-intel/core/src/incremental/*
code-intel/core/src/program-analysis/*
code-intel/core/src/snapshots/*
code-intel/core/tests/**
README.md
CHANGELOG.md
openspec/**
```

Do not rewrite subsystems merely to satisfy the release proposal. Reuse current Generation V2 verification, semantic normalizers, runtime lifecycle, package validation, workflow registry validation and existing tests wherever they already prove the required property.

## Test strategy summary

1. clean-build tests proving no test-side-effect dependency;
2. exact-SHA pre-release CI;
3. semantic convergence tests;
4. cache producer-fingerprint invalidation tests;
5. real upgrade/rollback smoke tests;
6. package-content and isolated-install tests;
7. runtime bundle structural/executable tests;
8. Docker build/smoke/security gates;
9. program-analysis capability/doc consistency checks;
10. OpenSpec/README/CHANGELOG consistency review;
11. post-publication downloaded-artifact smoke tests.
