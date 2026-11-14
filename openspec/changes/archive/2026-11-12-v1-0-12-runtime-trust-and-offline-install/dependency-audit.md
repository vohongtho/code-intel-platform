# Verifier dependency audit

Recorded 2026-11-03. This is the design's "dependency review gate" for the runtime attestation verifier.

## Decision

Use `@sigstore/verify@3.1.1` directly, pinned exactly, plus the two packages its public API needs for input parsing: `@sigstore/bundle@4.0.0` and `@sigstore/protobuf-specs@0.5.2`. Do not add the `sigstore` umbrella package or `@sigstore/tuf`. Both bring the network/TUF client stack, which an offline verifier does not need.

## Findings

| Check | Result |
|---|---|
| License | All four packages (`verify`, `bundle`, `core`, `protobuf-specs`) are Apache-2.0. They are compatible with MIT distribution and pass the existing `license-checker --failOn GPL…` gate. |
| Transitive dependencies | 4 packages total: `@sigstore/verify` → `@sigstore/bundle`, `@sigstore/core`, `@sigstore/protobuf-specs`. No other transitive packages. |
| Native code / install scripts | None. All four packages are pure JS, and none defines an `install`/`postinstall` script. |
| Network surface | The only non-relative imports in the four `dist/` trees are `crypto`, `util` and the sibling `@sigstore/*` packages. No `http`, `https`, `net`, `tls`, `dns` or `fetch`. |
| Node engine | 3.1.1 declares `^20.17.0 \|\| >=22.9.0`, which covers the project's `>=22` floor. 4.x declares `^22.22.2 \|\| ^24.15.0`, which excludes current 24.12 installs. That is why 4.x was not chosen. |
| Maintenance | sigstore-js org project. 3.1.1 was published 2026-05-22 as a maintenance release of the 3.x line, and 4.x is active. Each version is published with npm provenance. |
| Vulnerabilities | `npm audit` in an isolated install: 0 vulnerabilities. |
| Size | ~1.05 MB unpacked for all four packages, added to each of the four runtime targets (each target already carries tens of MB of `node_modules`). |
| Lockfile impact | Purely additive: +47 lines in `package-lock.json`, with no existing entry changed. |

## Zero-network proof (design gate)

The fixture is a real GitHub Actions-signed Sigstore v0.3 bundle. It is the npm provenance attestation for `@sigstore/verify@3.1.1`, the same DSSE/in-toto bundle format that `actions/attest-build-provenance` emits for our index. The fixture also includes the Sigstore public-good trusted root and the attested tarball.

1. A scratch script replaced `fetch`, `net.connect`, `tls.connect`, `http(s).request/get` and `dns.lookup` with throwing stubs. It verified certificate chain, Rekor inclusion, CT and identity, then the subject digest. Result: verified, 0 network attempts.
2. The same script, run under `unshare -rn` (a network namespace with no interfaces), also verified.
3. The same bundle checked against the pinned Code Intel identity policy was rejected with `UNTRUSTED_SIGNER_ERROR` (mapped to `IDENTITY_MISMATCH`).

This proof is now a permanent unit test: `tests/unit/cli/runtime-trust.test.ts`, "verifies a real bundle end to end with every network primitive denied".

## Trust-anchor decision

The verifier is offline, so it needs a trusted root that it does not fetch. Each runtime archive ships `trust/sigstore-trusted-root.json`. The release workflow refreshes it with `gh attestation trusted-root` before bundling. The installed (already trusted) runtime uses its pinned root to authenticate the next release. The bundle directory is never used as a trust source. `--trusted-root <file>` is an explicit operator override, recorded in the receipt as `trustRootSource: "operator"`.

Known limit: if Sigstore rotates the keys that sign a future release, and an installed runtime's pinned root predates that rotation, offline verification fails closed with `ATTESTATION_INVALID`. The operator then supplies a current root from a trusted channel via `--trusted-root`, or upgrades online first. The installer never falls back to checksum-only and labels the result `verified`.

## Release security gate remediation (2026-11-11)

Task 6.3 runs the same audit gates as CI. On 2026-11-11 they failed on advisories published after the baseline against existing dependencies. None of the findings were in the `@sigstore/*` packages.

| Gate | Before | After |
|---|---|---|
| `npm audit --audit-level=high --omit=dev` (`publish.yml`, `release-validate.yml`, `test.yml`) | 19 (11 high, 1 critical) | 0 |
| `npm audit --audit-level=high` (`release-readiness.yml`) | 33 (11 high, 3 critical) | 11 moderate, 0 high/critical |

Changes:

- `npm audit fix` without `--force`: in-range lockfile updates only.
- Root `overrides` were moved to the patched versions the lockfile now resolves: `sharp` 0.35.5, `hono` 4.13.18 (top level and under `@modelcontextprotocol/sdk`), `brace-expansion` 5.0.13, `fast-uri` 3.1.9, `ip-address` 10.7.6, `@hono/node-server` 2.1.7. The old exact pins (`brace-expansion` 5.0.9 and the others) were what kept the vulnerable versions installed. Leaving pins below the locked versions would also make `npm ci` reject the lockfile.
- `minimatch` stays on `^10.0.0`. Its high finding came only from the pinned `brace-expansion`. `minimatch` 11 was tried and rejected: it drops the `makeRe` export that `pipeline/phases/scan-phase.ts` uses, and it would add a new runtime dependency (`@isaacs/nonrecursive-glob-match`).
- Web `vitest` ^3.2.4 → ^4.1.12 (dev only). Both critical `tinypool` advisories (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr) cover all of 1.x, and `vitest` 4 no longer depends on `tinypool`. Web suite: 52/52 pass; Web build passes.
- No new runtime dependency was added. The 11 remaining moderate findings are below every gate's threshold.
