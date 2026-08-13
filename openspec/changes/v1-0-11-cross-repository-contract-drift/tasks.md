# Tasks: Cross-Repository Contract Drift

- [ ] 1. Inventory existing group contract storage, sync, cross-repo links, route/schema/event extraction, and group MCP schemas.
- [ ] 2. Define stable contract identity/version/fingerprint and drift-finding contracts with shared certainty/coverage.
- [ ] 3. Persist contract semantic fingerprints and producer/consumer role metadata in Generation V2/group artifacts.
- [ ] 4. Implement HTTP comparator by reusing graph-aware API contracts rather than duplicating route/shape logic.
- [ ] 5. Implement schema comparator for removal, requiredness, type-category change, and exact known consumer field usage.
- [ ] 6. Implement event comparator for topic/name and statically modeled payload compatibility.
- [ ] 7. Build reverse contract-consumer index with bounded deterministic expansion.
- [ ] 8. Integrate immutable base/head semantic snapshots; missing repository snapshots must surface partial coverage.
- [ ] 9. Add `group_contract_drift` MCP/HTTP operation using existing group identity/auth/error conventions.
- [ ] 10. Add optional cross-repository compatibility section to existing `pr_impact` for synchronized groups.
- [ ] 11. Connect findings to existing flows and suggested tests when exact relationships exist.
- [ ] 12. Add incremental recomparison by changed contract fingerprints plus full-group fallback.
- [ ] 13. Add fixtures with producer/backend, frontend consumer, shared schema, and event publisher/subscriber repositories.
- [ ] 14. Add negative/unknown fixtures for dynamic consumers, unsynchronized repositories, ambiguous contracts, and analysis truncation.
- [ ] 15. Add performance tests for 10/100/1000 contracts and bounded query shape.
- [ ] 16. Validate stable deterministic output and reopen persisted artifacts after sync/publication.
