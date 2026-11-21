<!-- code-intel:workflow-change-session-fragment -->
## Change session (when the `change_workflow` tool is available)

If the connected Code Intel runtime does not list `change_workflow`, skip this section and follow the steps above — but then you have no durable expected-vs-actual verification, so say so instead of claiming the change is verified.

1. **Start or join.** `change_workflow` with `action: "start"`, a `task`, and any `targets` you already know (canonical node IDs are exact; ambiguous names become candidates). To resume, use `action: "status"` with the `session_id`. Pass `scope: "group"` and `group` for cross-repository changes. A stale index refuses to start: run `code-intel analyze` first.
2. **Read the plan honestly.** `required` steps are backed by exact evidence; `candidate` steps need verification before they are binding; `blocked` steps and capability boundaries mean Code Intel cannot analyze that part — report them, don't paper over them.
3. **Declare intent.** If a change is meant to break a contract or replace a declaration, record it with `action: "checkpoint"` (`conditions`, `remove_condition_ids`, `step_id`) before verifying, so it is not reported as unexpected.
4. **Edit outside Code Intel.** You make the edits; Code Intel never edits files or touches Git.
5. **Reindex.** Run `code-intel analyze` in every changed repository (and `code-intel group sync <group>` for group sessions).
6. **Verify.** `action: "verify"` with the `expected_revision` from the last response.
   - `reindex-required` → analyze again, then verify. Never reason from the stale result.
   - `needs-revision` → fix the change or restate expectations, re-analyze, verify again.
   - `blocked`, or any required condition `unknown` / `partially-satisfied` → **stop and report**; do not claim completion.
7. **Complete only after `passed`.** `action: "complete"` records completion and returns a *suggested* commit plan. Do not stage, commit or push unless the user asked you to.
<!-- /code-intel:workflow-change-session-fragment -->
