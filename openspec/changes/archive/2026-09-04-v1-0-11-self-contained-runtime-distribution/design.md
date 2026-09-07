# Design: Self-Contained Runtime Distribution

## Layout

```text
<install-root>/
  versions/
    1.0.11/
      runtime/node
      app/
      web/
      parsers/
      native/
      manifest.json
  current -> versions/1.0.11
  bin/code-intel
  config/            # persistent
```

Windows may use an atomic pointer file/launcher instead of symlink where necessary.

## Manifest

Manifest contains application version, platform, architecture, Node version, artifact checksums, parser/native component fingerprints, minimum OS constraints, build commit, and SBOM/provenance references.

## Launcher

Launcher resolves the selected version, sets only required internal runtime paths, and executes bundled Node with the application entrypoint. It must avoid shadowing unrelated system tools.

## Install

Install verifies archive checksum, extracts into a temporary version directory, verifies manifest contents, performs smoke checks, then atomically registers the version and switches `current`. Failure before switch leaves existing install usable.

## Upgrade and rollback

`upgrade` installs a new version side-by-side and switches only after verification. `version pin <version>` selects an installed version and prevents implicit upgrade selection. Rollback is a pointer switch after compatibility checks; it does not downgrade repository index schema silently. If an older runtime cannot read an index, it reports reanalysis/migration required.

## Doctor

`doctor` checks:

- launcher/current version integrity;
- bundled Node execution;
- native LadybugDB load;
- Tree-sitter WASM presence/load for canonical languages;
- writable config/cache/index locations;
- repository Generation V2 metadata/artifact reopen when run in a repo;
- MCP configuration target/path conflicts;
- optional PATH conflicts with other `code-intel` binaries.

Output must distinguish pass/warn/fail and provide deterministic machine-readable JSON mode for CI/support.

## Uninstall

Remove installed runtime versions/launcher only by default. Preserve user config/indexes unless explicit `--purge-data` is supplied. Purge operation must display/require explicit destructive intent according to CLI conventions.

## CI matrix

Test fresh minimal images/VMs with no Node/npm. Run installer, `code-intel --version`, init/analyze a fixture, launch/query MCP, upgrade to another test version, rollback, uninstall, and verify persistent data policy.

## Supply-chain

Generate per-artifact SHA-256, SBOM, build commit metadata, and signing/provenance when CI platform supports it. Verification failures are fatal before version activation.
