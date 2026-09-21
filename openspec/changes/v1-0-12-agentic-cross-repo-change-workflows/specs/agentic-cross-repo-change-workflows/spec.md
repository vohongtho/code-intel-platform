# Capability: Agentic cross-repository change workflows

## ADDED Requirements

### Requirement: Change workflows are resumable and verification-driven
The system SHALL persist a versioned change-workflow session that can move from planning through external implementation, reindexing, verification, review and completion.

#### Scenario: External edit makes index stale
GIVEN a workflow is ready for change
AND the user or agent edits tracked source
WHEN workflow status/verify observes that the semantic index is stale
THEN the session enters/reports `reindex-required`
AND semantic verification does not proceed as though the stale graph represents the edited source.

#### Scenario: Verification matches the plan
GIVEN source was changed and reanalyzed
WHEN all expected semantic conditions are observed with sufficient evidence
THEN those conditions are marked `satisfied`
AND review may proceed.

### Requirement: Unknown evidence cannot satisfy a planned condition
#### Scenario: Expected consumer update cannot be analyzed
GIVEN a planned cross-repo consumer update
AND the consumer repository or contract coverage is partial
WHEN verification runs
THEN the condition is `unknown` or `blocked`
AND not `satisfied`.

### Requirement: Session updates are conflict-safe
#### Scenario: Two clients update the same session revision
GIVEN both read revision N
WHEN one writes revision N+1 first
THEN the second stale update is rejected with a revision conflict
AND the newer checkpoint is not overwritten.

### Requirement: Commit plans are suggestions only
#### Scenario: Workflow generates commit groups
GIVEN a workflow session has verified changed files and symbols
WHEN a verified session requests a commit plan
THEN changed files/symbols may be grouped with suggested messages
AND Code Intel SHALL NOT stage, commit, rewrite history or push.

### Requirement: System flows cross repositories only through evidence-backed contracts
#### Scenario: Exact HTTP contract consumer
GIVEN a provider local flow reaches a route contract
AND group sync has an exact consumer in another repository
AND the consumer maps to a stable local flow
WHEN system-flow stitching runs
THEN the two local flows may be joined with the contract boundary and certainty evidence.

#### Scenario: Same endpoint-like name but no contract match
GIVEN two repositories contain similarly named methods
AND no evidence-backed provider/consumer contract link exists
WHEN stitching runs
THEN no exact cross-repository continuation is created.

#### Scenario: Consumer match is ambiguous
GIVEN a provider contract has candidate consumers only
WHEN stitching runs
THEN candidate continuations may be returned separately
AND the system flow is not presented as an exact continuation through one candidate.

### Requirement: System-flow identity is deterministic
#### Scenario: Group semantic inputs are unchanged
GIVEN member snapshot IDs, stable local flows and contract links are unchanged
WHEN system flows are rebuilt
THEN their versioned identities/fingerprints are stable across runs.

### Requirement: Workflow capabilities degrade explicitly
#### Scenario: PDG or stable flow feature is unavailable
GIVEN a session can still use graph/contracts
WHEN planning or verification runs
THEN it uses the available lower-level capability
AND records the reduced guarantee
AND does not fabricate PDG/flow evidence.
