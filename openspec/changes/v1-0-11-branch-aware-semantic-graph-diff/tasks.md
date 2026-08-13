# Tasks: Branch-Aware Semantic Graph Diff

- [ ] 1. Inventory Generation V2 publication/staging ownership, Git helpers, `detect_changes`, `pr_impact`, graph reopen logic, and artifact fingerprints.
- [ ] 2. Define semantic snapshot descriptor/fingerprint excluding volatile metadata.
- [ ] 3. Implement safe Git tree/ref materialization without changing the user's working tree and with metacharacter/path fixtures.
- [ ] 4. Implement isolated snapshot analysis paths that cannot update the current published generation pointer.
- [ ] 5. Implement normalized node diff using canonical identities and deterministic sorting.
- [ ] 6. Implement normalized relationship diff preserving call-site identity and certainty/evidence changes.
- [ ] 7. Add conservative move/rename correlation; ambiguous continuity remains remove+add.
- [ ] 8. Integrate route/API contract and flow deltas when source artifacts are present.
- [ ] 9. Implement bounded reusable snapshot cache with reopen/read-back validation and eviction policy.
- [ ] 10. Extend `pr_impact` with optional semantic snapshot mode while retaining current textual diff evidence.
- [ ] 11. Add CLI/MCP/HTTP semantic graph-diff surface following existing selector/repository conventions.
- [ ] 12. Add Web visualization for add/remove/change/certainty deltas after API contract stabilizes.
- [ ] 13. Add full-vs-incremental snapshot convergence tests for body edit, rename, move, delete, added call, removed call, and changed route shape.
- [ ] 14. Add large-diff/query-shape benchmark; prohibit generated query syntax proportional to hunk/entity count.
- [ ] 15. Add failure tests for missing ref, partial analysis, interrupted snapshot build, stale cache metadata, and corrupted artifact.
- [ ] 16. Run release gate and prove current Generation V2 pointer is unchanged by read-only graph-diff operations.
