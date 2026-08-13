# Tasks: Self-Contained Runtime Distribution

## 1. Baseline inventory

- [ ] 1.1 Inspect root/package-level `package.json` files, `code-intel/core/package.json`, `code-intel/web/package.json`, `code-intel/core/src/cli/main.ts`, `code-intel/core/src/cli/app.ts`, parser/WASM asset loading, LadybugDB/native dependencies, Web build output, `.github/workflows/*`, and existing release/publish scripts.
- [ ] 1.2 Inventory every runtime file required by `analyze`, `serve`, `mcp`, Web UI, Tree-sitter parsers, vector runtime/model loading, and LadybugDB. Produce a machine-readable bundle-input manifest; do not rely on undocumented glob copying.
- [ ] 1.3 Identify persistent user data/config/index paths and prove they are outside the immutable versioned runtime directory before implementing uninstall/upgrade.

## 2. Distribution manifest and layout

- [ ] 2.1 Create `scripts/distribution/runtime-manifest.mjs` (or equivalent existing release-script location) describing product version, commit SHA, Node version, platform/arch, executable entrypoint, native assets, Web assets and schema compatibility.
- [ ] 2.2 Define versioned layout, e.g. `<installRoot>/versions/<version>/...`, a single atomic `current` selector/launcher, and persistent `<dataRoot>` owned separately. Document Windows path differences explicitly.
- [ ] 2.3 Add runtime manifest validation that fails build when a declared required asset is missing or an unexpected production dependency would require a system Node/npm/build tool.

## 3. Bundle build

- [ ] 3.1 Add release build script under `scripts/distribution/` to download/use a pinned official Node runtime for linux-x64, linux-arm64, darwin-x64 and darwin-arm64.
- [ ] 3.2 Copy compiled core `dist`, built Web assets, Tree-sitter WASM files, required package metadata/licenses and native LadybugDB/runtime binaries into the bundle from explicit manifest entries.
- [ ] 3.3 Ensure dynamic imports/assets resolve relative to bundled application/runtime rather than source checkout or global npm paths; add a bundle smoke test that executes from a temp directory with repository source unavailable.
- [ ] 3.4 Produce deterministic archive naming and include `runtime-manifest.json` inside every archive.

## 4. Launcher

- [ ] 4.1 Add platform launcher script/binary under `scripts/distribution/launcher/` or a dedicated runtime module. It MUST select bundled Node and the current installed version without consulting system `node`/`npm`.
- [ ] 4.2 Preserve argv byte/argument boundaries; never concatenate command arguments into shell strings. Verify paths containing spaces/metacharacters.
- [ ] 4.3 Forward exit code, stdout/stderr and signals from bundled CLI process correctly. `code-intel --version` MUST report application version plus bundled runtime metadata in doctor JSON.

## 5. Installer

- [ ] 5.1 Add install script(s) under `scripts/distribution/install/` that download/read an archive, verify SHA-256 and manifest before extraction, extract to a temporary version directory, validate launcher/runtime, then atomically activate it.
- [ ] 5.2 Existing active version MUST remain usable if download, checksum, extraction, validation or activation fails.
- [ ] 5.3 Installer MUST detect conflicting `code-intel` executables/PATH entries and report them without deleting unrelated installations.
- [ ] 5.4 Add non-interactive flags appropriate for CI and explicit install root override; defaults must be user-writable and not require root/admin for normal per-user install.

## 6. `doctor`

- [ ] 6.1 Create `code-intel/core/src/cli/doctor.ts` returning structured checks with `id`, `status`, `message`, `details`, and remediation. Wire command registration only in `code-intel/core/src/cli/app.ts`.
- [ ] 6.2 Check launcher/runtime version, bundled Node path, package/build commit, LadybugDB load/open, all configured Tree-sitter WASM assets, writable config/data/index directories, published Generation V2 trust, Web assets, MCP config references and PATH conflicts.
- [ ] 6.3 Support `code-intel doctor --json` with stable machine-readable schema and deterministic check ordering.
- [ ] 6.4 A failed optional component may report warning; missing/corrupt core runtime or DB/parser assets MUST return non-zero status. Never hide a failed health check behind a generic success summary.

## 7. Upgrade, versions, pin and rollback

- [ ] 7.1 Create `code-intel/core/src/cli/runtime-lifecycle.ts` only for CLI orchestration; download/install mechanics should live in a focused distribution/runtime service rather than `app.ts`.
- [ ] 7.2 Implement `code-intel upgrade [--version <v>]`, installed-version listing, `version pin <v>` and `rollback [<v>]` with side-by-side immutable versions.
- [ ] 7.3 Activation MUST be atomic. A version becomes current only after its runtime manifest, launcher smoke test and required asset checks pass.
- [ ] 7.4 Add index/schema compatibility check before rollback. If old runtime cannot safely open current persisted index schema, command MUST warn/fail with re-analysis guidance; never mark incompatible index healthy.
- [ ] 7.5 Define cleanup policy retaining current, pinned and rollback-safe previous versions; cleanup MUST never remove the active version.

## 8. Uninstall

- [ ] 8.1 Implement `code-intel uninstall` removing only managed launcher/version files owned by the installation manifest.
- [ ] 8.2 Default uninstall MUST preserve repository indexes, user config, logs and agent project files. Add explicit `--purge-data` with a pre-delete inventory/confirmation path and non-interactive safety flag.
- [ ] 8.3 Never recursively remove a user-selected directory unless ownership markers and resolved path match the expected Code Intel data root.
- [ ] 8.4 Add tests for partial/multiple installations and conflicting PATH executables.

## 9. Supply-chain metadata

- [ ] 9.1 Generate SHA-256 checksum file for all release archives and runtime manifests.
- [ ] 9.2 Generate SBOM for application dependencies/native components using the release workflow/tool selected by the repository; store product version and commit SHA in artifacts.
- [ ] 9.3 Add provenance/signing where supported by current CI/release environment; verification failure must block publishing self-contained artifacts.
- [ ] 9.4 Include third-party license notices required by bundled Node/native/package assets.

## 10. CI and platform tests

- [ ] 10.1 Add clean Linux x64/arm64 and macOS x64/arm64 CI jobs with no usable system Node/npm on PATH: install -> `--version` -> `doctor` -> initialize temp repo -> analyze -> MCP query -> serve/Web smoke -> upgrade -> rollback -> uninstall.
- [ ] 10.2 Add corrupted archive/checksum, interrupted extraction, read-only install root, missing native library, missing WASM, PATH conflict and incompatible rollback tests.
- [ ] 10.3 Assert persistent index/config data survives normal uninstall and upgrade.
- [ ] 10.4 Add Windows x64 build/launcher/install smoke only after native dependency support is verified; do not advertise Windows self-contained support before CI passes.

## 11. Existing npm/developer workflow compatibility

- [ ] 11.1 Preserve current npm/developer installation and `node` development workflows. Self-contained distribution is additive and MUST NOT alter source-development scripts unnecessarily.
- [ ] 11.2 Ensure `code-intel setup`, MCP generated configuration and hooks point to the stable launcher path, not a version-specific runtime path, so upgrades do not require regenerating all agent config.
- [ ] 11.3 Verify Generation V2 repository/index paths and user config ownership remain identical across npm and self-contained runtime unless a documented migration is required.

## 12. Documentation and release notes — mandatory Definition of Done

- [ ] 12.1 Update root `README.md` Installation section with self-contained installation, supported OS/architectures, no-system-Node requirement, npm/developer alternative, `doctor`, upgrade, pin/rollback and uninstall examples.
- [ ] 12.2 Update root `README.md` troubleshooting with PATH conflicts, native/WASM failures, preserved data behavior and index-compatibility guidance after rollback.
- [ ] 12.3 Update root `CHANGELOG.md` under `## [1.0.11]` with supported self-contained platforms, lifecycle commands, doctor diagnostics, supply-chain artifacts and known limitations.
- [ ] 12.4 Update release workflow/release notes templates so checksums/SBOM/provenance links and install instructions are generated from actual artifact names.
- [ ] 12.5 Documentation is mandatory: README/CHANGELOG examples MUST be exercised by clean-machine CI before marking the proposal complete.

## 13. Release gate

- [ ] 13.1 Run standard repository build/typecheck/lint/tests in npm/developer mode to prove packaging work does not regress existing workflow.
- [ ] 13.2 Run all clean-machine distribution jobs and archive verification.
- [ ] 13.3 Verify a machine with no system Node/npm can install, analyze a temp repository and start MCP using only bundle contents.
- [ ] 13.4 Verify failed upgrade leaves previous runtime executable and indexes/config intact.
