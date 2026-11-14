# Tasks: Runtime Trust and Offline Installation

## 1. Trust contracts
- [x] Add `runtime-trust.ts` and `runtime-bundle-index.ts` with versioned bounded schemas.
- [x] Audit the chosen Sigstore/GitHub-attestation verifier license, dependencies, offline behavior, maintenance and bundle-size impact.
- [x] Prove the exact verification bundle works with network access disabled; if it does not, return authenticity to design review and do not expose `verified`.
- [x] Add malformed, oversized, unknown-scheme and identity-policy tests.

## 2. Release index and verification material
- [x] Create `scripts/distribution/build-runtime-index.mjs` with deterministic target/sidecar hashes.
- [x] Update `.github/workflows/publish.yml` to attach the index and downloadable verification bundles.
- [x] Add release assertions that every index entry maps to an uploaded artifact and vice versa.

## 3. Installer transaction
- [x] Add bounded archive-member preflight to `runtime-lifecycle.ts` before extraction, rejecting absolute/traversal paths, unsafe links and special entries.
- [x] Extend `runtime-lifecycle.ts` to verify v1.0.12+ official archive authenticity before extraction/activation only after the verifier audit gate passes.
- [x] Preserve checksum-only v1.0.11 compatibility with `legacy-checksum`.
- [x] Add wrong signer, archive/index/sidecar tamper, path traversal/link/special-entry and atomic-failure tests in runtime lifecycle tests.

## 4. Offline flow
- [x] Add `upgrade --bundle-dir <dir> --offline` to `standalone-commands.ts`.
- [x] Add integration fixture with archive, checksum, SBOM, provenance, index and verification material.
- [x] Inject/observe network hooks and assert offline mode makes zero network calls.

## 5. Diagnostics
- [x] Add `verify-install [--json]`.
- [x] Extend `doctor.ts`, runtime metadata and doctor tests with authenticity/trust receipt.
- [x] Ensure diagnostics never expose signing secrets or unnecessary certificate blobs.

## 6. Release validation
- [x] Extend runtime integrity/distribution/smoke scripts.
- [x] Verify linux-x64, linux-arm64, darwin-x64, darwin-arm64. (2026-11-11: all four bundles built; integrity gate confirms trusted root, `@sigstore/verify` and `runtime-trust.js` in every archive. Only linux-x64 was executed end to end (clean-machine script); the other three were inspected, not run.)
- [x] Run npm/license/security/build/package/release gates. (2026-11-12: prod and full `npm audit --audit-level=high` pass after the remediation in dependency-audit.md; license: 468 production packages checked locally against the CI `--failOn` list, the only LGPL hit is `@img/sharp-libvips-*` `LGPL-3.0-or-later`, unchanged since v1.0.11, whose license gate passed; core/Web build, `validate:dist`, bundle integrity, clean-machine distribution and index one-to-one gates pass; full core suite 2830/2834 pass, the 3 failures are pre-existing: see release-evidence.)
