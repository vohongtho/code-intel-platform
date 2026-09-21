# Tasks: Runtime Trust and Offline Installation

## 1. Trust contracts
- [ ] Add `runtime-trust.ts` and `runtime-bundle-index.ts` with versioned bounded schemas.
- [ ] Audit the chosen Sigstore/GitHub-attestation verifier license, dependencies, offline behavior, maintenance and bundle-size impact.
- [ ] Prove the exact verification bundle works with network access disabled; if it does not, return authenticity to design review and do not expose `verified`.
- [ ] Add malformed, oversized, unknown-scheme and identity-policy tests.

## 2. Release index and verification material
- [ ] Create `scripts/distribution/build-runtime-index.mjs` with deterministic target/sidecar hashes.
- [ ] Update `.github/workflows/publish.yml` to attach the index and downloadable verification bundles.
- [ ] Add release assertions that every index entry maps to an uploaded artifact and vice versa.

## 3. Installer transaction
- [ ] Add bounded archive-member preflight to `runtime-lifecycle.ts` before extraction, rejecting absolute/traversal paths, unsafe links and special entries.
- [ ] Extend `runtime-lifecycle.ts` to verify v1.0.12+ official archive authenticity before extraction/activation only after the verifier audit gate passes.
- [ ] Preserve checksum-only v1.0.11 compatibility with `legacy-checksum`.
- [ ] Add wrong signer, archive/index/sidecar tamper, path traversal/link/special-entry and atomic-failure tests in runtime lifecycle tests.

## 4. Offline flow
- [ ] Add `upgrade --bundle-dir <dir> --offline` to `standalone-commands.ts`.
- [ ] Add integration fixture with archive, checksum, SBOM, provenance, index and verification material.
- [ ] Inject/observe network hooks and assert offline mode makes zero network calls.

## 5. Diagnostics
- [ ] Add `verify-install [--json]`.
- [ ] Extend `doctor.ts`, runtime metadata and doctor tests with authenticity/trust receipt.
- [ ] Ensure diagnostics never expose signing secrets or unnecessary certificate blobs.

## 6. Release validation
- [ ] Extend runtime integrity/distribution/smoke scripts.
- [ ] Verify linux-x64, linux-arm64, darwin-x64, darwin-arm64.
- [ ] Run npm/license/security/build/package/release gates.
