# Tasks: Graph-Aware API Contracts

- [ ] 1. Inventory existing route nodes, route parsers, group route contracts, edge kinds, MCP schemas, and HTTP handlers; document which abstractions will be reused.
- [ ] 2. Add universal route/shape/consumer semantic fact contracts with stable source anchors and canonical identity references.
- [ ] 3. Implement route normalization with fixtures for literal segments, parameters, nested routers/controller prefixes, and unsupported dynamic prefixes.
- [ ] 4. Adapt existing Express/Fastify route discovery to emit route contract facts without changing current route behavior.
- [ ] 5. Add NestJS producer extraction for controller prefixes, method decorators, handlers, middleware/guard evidence where statically available, request DTOs, and response DTO/object keys.
- [ ] 6. Add ASP.NET Core producer fixtures/adapters for controller/minimal-API routes as capability permits.
- [ ] 7. Add fetch/Axios/Angular HttpClient consumer facts including method, URL expression, request shape, expected response type, and consumed response keys where statically knowable.
- [ ] 8. Implement bounded producer-consumer matching and negative tests proving suffix/sub-string collisions do not create exact links.
- [ ] 9. Project API contract relationships into the graph and persist/reopen all new compact metadata/evidence references.
- [ ] 10. Implement compatibility comparison with base/head unit fixtures for route removal, method change, response-key removal, optional additions, required request additions, and unknown shapes.
- [ ] 11. Add `api_contract`, `api_impact`, and `api_drift` MCP/HTTP schemas using existing repo/selector/error conventions.
- [ ] 12. Integrate API findings additively into `pr_impact` and repository-group contracts without duplicating generic traversal.
- [ ] 13. Add dependency-aware incremental invalidation for changed producer, consumer, and shape facts; compare normalized incremental output with a clean full rebuild.
- [ ] 14. Add Web UI contract/impact view only after MCP/HTTP contracts are stable.
- [ ] 15. Add metrics for extraction coverage, unresolved dynamic URLs, ambiguous matches, link precision fixtures, and compatibility findings.
- [ ] 16. Run canonical 15-language matrix; non-web languages may report not-applicable but shared semantic infrastructure must pass.
- [ ] 17. Run full release gate and reopen Generation V2 graph/evidence/metadata artifacts before checking tasks complete.
