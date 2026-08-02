# Operations Runbook

## Index missing, stale, legacy, or corrupt

```bash
code-intel index-status .
code-intel status .
```

`index-status` exit meaning:

- `0` — trusted/current;
- `1` — stale or legacy;
- `2` — missing or corrupt.

Upgrade legacy trust metadata:

```bash
code-intel index-status . --upgrade-legacy
```

## Normal source changes

Run a normal analysis first:

```bash
code-intel analyze .
```

In 1.0.9, changed source triggers a full graph rebuild while vector writes remain scoped to changed and deleted files.

## Corrupt index or incompatible metadata

```bash
code-intel clean . --purge
code-intel analyze . --force --embeddings
```

Do not use force as the default response to every source change.

## MCP starts with the wrong repository

Use an absolute path:

```bash
code-intel mcp /absolute/path/to/repository
```

Then call `overview` and verify the expected node, edge, and file counts.

## MCP connects but tools are empty

```bash
which code-intel
code-intel --version
code-intel index-status /absolute/path/to/repository
code-intel status /absolute/path/to/repository
```

Run the exact configured MCP command in a terminal. It should remain active and wait on stdio.

## MCP tool timeout

```bash
export CODE_INTEL_MCP_TIMEOUT_MS=60000
```

The server returns a non-fatal truncated response when a tool exceeds the timeout.

## Vector search falls back to BM25

```bash
code-intel analyze --embeddings
code-intel status
```

Check that vector storage exists and metadata is compatible. Search responses should report requested and actual execution modes.

## Database lock or concurrent access

Stop duplicate `serve`, `watch`, `mcp`, or analysis processes that are opening the same index. Prefer one writer at a time.

For a detached server:

```bash
code-intel stop .
```

## Watcher and live graph

```bash
code-intel watch . --port 4747
```

When watcher patching fails, inspect `~/.code-intel/logs/`, stop the watcher, and run a normal analysis to restore a known-good persisted index.

## Changed-file context in CI

```bash
git diff --binary origin/main...HEAD > change.diff
code-intel change-context . --diff-file change.diff --max-tokens 6000
```

For a dedicated transport:

```bash
code-intel change-context-mcp .
code-intel change-context-http . --host 127.0.0.1 --port 30128
```

## Pull-request review sequence

```text
index-status
→ detect_changes or change-context
→ pr_impact
→ explain_relationship
→ suggest_tests
→ health_report
```

Do not treat a clean health report as proof that application tests pass.

## OpenSpec change sequence

```text
/opsx:explore
→ Code Intel overview/search/inspect/blast_radius
→ /opsx:propose
→ /opsx:apply
→ Code Intel detect_changes/pr_impact/suggest_tests
→ /opsx:verify
→ /opsx:archive
```

If the implementation diverges from the accepted design, update the OpenSpec artifacts before archive.

## Installation and startup diagnosis

```bash
which code-intel
code-intel --version
node --version
npm --version
code-intel doctor
```

Use the absolute binary path in MCP configuration when GUI clients do not inherit shell `PATH`.

## Windows and WSL

Keep the client, Node runtime, Code Intel binary, and repository path in the same environment. Native Windows clients launching npx may need `cmd /c`. Do not combine `C:\...` and `/home/...` paths in one MCP definition.

## Backup before destructive repair

```bash
code-intel backup create .
code-intel backup list
```

Then use `clean --purge` or migration rollback only when necessary.

## Release upgrade checklist

1. Install the target version.
2. Confirm `code-intel --version`.
3. Run `code-intel index-status .`.
4. Review release-specific metadata or schema changes.
5. Run normal analysis, using `--force` only when required.
6. Verify MCP `overview`, search, inspect, and blast radius.
7. Verify generated instruction files preserve custom content.
8. Run project tests independently of Code Intel checks.