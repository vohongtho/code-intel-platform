# v1.0.12: Runtime Trust and Offline Installation

## Change ID
`v1-0-12-runtime-trust-and-offline-install`

## Feature IDs
F02, F19

## Priority
P0

## Summary
Close the remaining trust gap in the self-contained runtime by making runtime archives authenticity-verifiable by Code Intel itself, and define a complete air-gapped release bundle.

## Source-verified baseline
v1.0.11 already ships self-contained archives for Linux/macOS x64/arm64. The release pipeline generates SHA-256, CycloneDX SBOM, provenance sidecars and GitHub artifact attestations. Docker images are keyless-cosign signed. `runtime-lifecycle.ts` provides archive upgrade/rollback/uninstall and `doctor.ts` validates layout. It verifies the archive checksum, but currently invokes `tar -xzf` before validating archive member paths; safe pre-extraction entry validation is therefore part of this change rather than an existing protection.

The gap is narrower: local runtime installation validates checksum material but does not establish artifact authenticity from an offline-verifiable signed/attested bundle. A copied archive plus copied/tampered checksum is therefore integrity data without independently established publisher identity.

## Required release bundle
For every runtime target publish:
- archive;
- SHA-256;
- SBOM;
- provenance JSON;
- downloadable verification/attestation bundle;
- one authenticated release-index entry.

Add `code-intel-runtime-index-v1.json` containing release version/tag/commit, target, artifact filenames/sizes/hashes, expected repository/workflow identity, minimum installer version and verification scheme version.

## Verification model
Preferred approach: reuse the existing GitHub/Sigstore release identity.
1. Release workflow produces/downloads an attestation verification bundle for each archive/index subject.
2. Installer verifies subject digest and signer certificate/workflow identity against pinned Code Intel policy.
3. It verifies archive/SBOM/provenance hashes from the authenticated release index.
4. It records a local trust receipt.

A Sigstore verifier dependency is allowed only after license/security/offline/package-size audit and a fixture proves that verification succeeds with network access disabled. The audit is an implementation gate: safe archive extraction and bounded index parsing may proceed first, but the `verified` state and authenticated offline installation SHALL NOT ship until an acceptable verifier is proven. If no suitable offline verifier exists, authenticity returns to design review; checksum-only validation remains `legacy-checksum` or `unverified`.

## CLI
```bash
code-intel verify-install --json
code-intel upgrade --bundle-dir /media/code-intel-v1.0.12 --offline
```

Existing `upgrade --archive ... --checksum-file ...` remains compatible.

Authenticity states:
- `verified`;
- `legacy-checksum`;
- `unverified`;
- `invalid`.

A valid v1.0.11 checksum-only runtime may remain usable but is never relabeled `verified`.

## Offline behavior
`--offline` SHALL:
- perform zero network fetches;
- resolve required files only from the explicit bundle directory;
- verify authenticity/integrity before activation;
- preserve current runtime on any failure;
- report optional embedding-model caches separately rather than trying to download them.

## Security
Checksum/authenticity verification and archive-member path/type validation precede extraction. Extraction uses a bounded staging directory and SHALL reject absolute paths, traversal, unsafe link targets and unsupported special entries before invoking the extractor. This safe-extraction requirement is independent of publisher authenticity. Release-index JSON and paths are bounded and untrusted. A valid signature for another repo/workflow is rejected. No signing secret is installed.

## Compatibility
Old installed versions remain runnable. Trust receipt is additive metadata. Rollback keeps each version's own receipt and cannot borrow trust from another archive.

## Non-goals
General package manager; authenticity of third-party model files; replacing npm provenance; Windows runtime bundles; mandatory network verification.

## Acceptance
Tampered archive/checksum/index/SBOM/provenance fails; wrong signer identity fails; valid bundle verifies with network disabled; activation is atomic; doctor exposes truthful state; all four existing runtime targets package the verifier correctly.
