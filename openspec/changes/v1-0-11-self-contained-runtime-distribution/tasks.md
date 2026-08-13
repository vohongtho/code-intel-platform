# Tasks: Self-Contained Runtime Distribution

- [ ] 1. Inventory runtime dependencies, native modules, Tree-sitter WASM assets, Web assets, current package/bin entrypoints, config/index paths, and release workflows.
- [ ] 2. Define platform manifest and versioned install layout separating immutable runtime from persistent user data.
- [ ] 3. Build Linux x64/arm64 and macOS x64/arm64 release bundles with pinned Node and required assets.
- [ ] 4. Implement launcher with deterministic bundled runtime selection and safe argument forwarding.
- [ ] 5. Implement atomic installer with archive/checksum/manifest verification and failure rollback.
- [ ] 6. Implement `code-intel doctor` human and JSON output covering runtime, native DB, parsers, storage, MCP config, and PATH conflicts.
- [ ] 7. Implement side-by-side `upgrade`, installed-version listing, pinning, and rollback semantics.
- [ ] 8. Implement `uninstall` preserving data by default and explicit `--purge-data` behavior.
- [ ] 9. Define index compatibility behavior when rolling runtime backward; never silently open unsupported schema as healthy.
- [ ] 10. Generate SHA-256 checksums, SBOM, build commit metadata, and available CI provenance/signatures.
- [ ] 11. Add clean-machine CI with no Node/npm: install -> version -> init -> analyze -> MCP query -> upgrade -> rollback -> uninstall.
- [ ] 12. Add corruption, interrupted extraction, read-only directory, missing native library, and PATH-conflict tests.
- [ ] 13. Add Windows x64 packaging after native/launcher smoke tests pass on Windows CI.
- [ ] 14. Document npm/developer install remains supported and self-contained installation is an additional distribution channel.
