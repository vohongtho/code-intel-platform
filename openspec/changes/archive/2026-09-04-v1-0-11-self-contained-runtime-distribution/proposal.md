# Proposal: Self-Contained Runtime Distribution

## Summary

Provide versioned release bundles containing the tested Node runtime and Code Intel runtime assets so users can install, diagnose, upgrade, pin, rollback, and uninstall without requiring a separately managed Node/npm toolchain.

## User-visible problem

The application currently depends on a compatible system Node environment plus native/WASM assets. Installation failures caused by Node versions, PATH conflicts, missing native libraries, parser assets, or partial upgrades create support cost unrelated to code intelligence.

## Goals

- Produce self-contained bundles for supported OS/architecture targets.
- Include a known-good Node runtime, compiled application, Web assets, Tree-sitter WASM, and required native database/runtime assets.
- Add atomic versioned install layout with a `current` pointer/launcher.
- Add `code-intel doctor`, `upgrade`, `uninstall`, and version pin/rollback workflows.
- Preserve npm/developer installation for contributors and existing users.
- Generate checksums, SBOM, and release provenance metadata.
- Add clean-machine CI proving install -> init/analyze -> MCP startup without system Node/npm.

## Initial targets

- Linux x64 and arm64.
- macOS x64 and arm64.
- Windows x64 after launcher/native-path behavior is validated.

## Non-goals

- Rewriting TypeScript components in Rust/Go.
- Bundling repository indexes into the executable.
- Replacing package-manager development workflows.
- Auto-updating without explicit user action.

## Compatibility

Existing `npm`/`npx` workflows continue. Configuration, repository indexes, auth state, and user data live outside version directories so upgrades do not replace them.

## Security

Release artifacts require checksums and SBOM. Upgrade downloads must validate expected version/artifact identity before switching `current`. Installer must not execute repository-controlled scripts.

## Release risk

Medium. Native dependencies and platform packaging are the primary risk; lifecycle operations must be atomic and recoverable.
