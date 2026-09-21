# Design: Runtime Trust and Offline Installation

## Existing owners
Reuse `code-intel/core/src/cli/runtime-lifecycle.ts`, `runtime-metadata.ts`, `runtime-launcher.ts`, `doctor.ts`, `scripts/distribution/build-runtime-bundle.mjs`, runtime manifest/install scripts and `.github/workflows/publish.yml`.

## New modules
- `code-intel/core/src/cli/runtime-trust.ts`;
- `code-intel/core/src/cli/runtime-bundle-index.ts`;
- `scripts/distribution/build-runtime-index.mjs`;
- a Sigstore verification adapter selected only after dependency audit.

```ts
type RuntimeAuthenticity = 'verified' | 'legacy-checksum' | 'unverified' | 'invalid';

interface RuntimeTrustReceipt {
  schemaVersion: 1;
  version: string;
  target: string;
  artifactSha256: string;
  authenticity: RuntimeAuthenticity;
  signerScheme?: string;
  repository?: string;
  workflowIdentity?: string;
  verifiedAt?: string;
}
```

## Release flow
```text
build target archives/sidecars
 -> deterministic runtime index
 -> attest archive/index subjects
 -> materialize downloadable verification bundles
 -> run clean-machine verification
 -> attach all files to release
```

Docker signing remains unchanged.

## Install transaction
```text
parse bounded bundle index
 -> select exact target/version
 -> verify release identity/attestation
 -> verify all listed hashes
 -> inspect archive entries
 -> extract to staging
 -> validate runtime manifest/native/parser/web assets
 -> write trust receipt
 -> atomically activate
```

No trust receipt is written before successful validation. Failure removes staging and leaves current/pinned versions unchanged.

## Offline contract
The authenticated index names all required files. Offline mode never searches npm/GitHub/model registries. Optional vector-model readiness remains a separate doctor check.

## Legacy migration
Existing runtimes with no receipt are inspected from their runtime manifest and available checksum data. They may become `legacy-checksum` but never `verified` retroactively.

## Identity policy
Verifier pins repository `vohongtho/code-intel-platform` and allowed release workflow identity. Identity policy is versioned so workflow path changes require an explicit release-policy update.

## Dependency review gate
Before adding a verifier package, record:
- license;
- transitive licenses;
- native dependencies;
- offline bundle verification support;
- security/maintenance history;
- package size on four runtime targets.

The gate also requires an isolated fixture proving zero-network verification of the exact downloadable bundle format. Until it passes, code may add bounded index parsing and safe extraction, but it must not emit `verified` or enable authenticated `--offline` activation.

## Safe extraction
The current lifecycle checksum-verifies and then runs `tar -xzf`; it does not inspect members first. Add a preflight that enumerates archive members without extraction, bounds entry count/path length/expanded size where available, and rejects absolute paths, `..` traversal, unsafe symlink/hardlink targets and special device entries. Only a preflight-approved archive may be extracted into a fresh staging directory. This protects filesystem integrity but does not establish publisher authenticity.

## Failure semantics
Malformed/oversized index, missing sidecar, wrong target, wrong digest, wrong signer, stale/unsupported scheme, corrupt archive or failed post-extract validation all fail closed.

## Tests
Unit: schema limits, identity policy, receipt migration, hashes and archive-member policy.
Integration: archive traversal/link/special-entry rejection before extraction; offline valid/tampered/wrong identity; atomic preservation; old 1.0.11; zero-network verifier proof.
Distribution: packaged verifier/runtime on all four targets.
