# Tasks: v1.0.12 Release Program

## 1. Planning baseline

- [x] Validate the baseline SHA, package versions, latest released tag and the F01–F22 capability map against the implementation before beginning feature work.
- [x] Keep `openspec/project.md`, `openspec/config.yaml`, and `openspec/AGENTS.md` aligned with v1.0.12. (`openspec/AGENTS.md` was intentionally removed in `3802ad7c`; see release-evidence.md §2.)
- [x] Run OpenSpec validation for this umbrella change and all eight detailed v1.0.12 changes.
- [x] Verify every detailed-change identifier in the F01–F22 map resolves to an existing change directory.
- [x] Record already-delivered baseline behavior, including the existing Web graph-diff page, rather than scheduling duplicate implementation.

## 2. Dependency tracking

- [x] Record the implementation order and dependency status of all detailed changes in release evidence.
- [x] Track the seven delivery checkpoints from planning repair through workflow/system-flow integration.
- [x] Do not mark an earlier feature as implemented if the baseline already contains it; record the v1.0.12 delta only.
- [x] Require each detailed change to publish capability/coverage boundaries for unsupported language/framework/ref states.

## 3. Release integration

- [x] Add one v1.0.12 release-readiness matrix that references the focused gates from all selected detailed changes.
- [x] Run build, typecheck, core tests, Web tests, e2e, packaging, runtime distribution, security/license and OpenSpec validation on the final candidate.
- [x] Update README/CHANGELOG/release notes only after implemented behavior matches the selected detailed changes.
