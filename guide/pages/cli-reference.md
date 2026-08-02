# CLI Reference

This page is derived from the actual `release/1.0.9` CLI source. It includes both Commander commands and standalone commands dispatched before Commander.

## First-run and configuration

```bash
code-intel init
code-intel init --reset
code-intel init --yes

code-intel config get <key>
code-intel config set <key> <value>
code-intel config list
code-intel config validate
code-intel config reset --yes

code-intel completion bash
code-intel completion zsh
code-intel completion fish

code-intel setup
code-intel setup --completion
```

`setup --completion` installs completion and exits. Run plain `code-intel setup` separately when MCP and agent integration are also required.

## Analyze and index

```bash
code-intel analyze [path]
code-intel analyze [path] --name <repo-name>
code-intel analyze --force
code-intel analyze --incremental
code-intel analyze --parallel
code-intel analyze --embeddings
code-intel analyze --skip-embeddings
code-intel analyze --skip-agents-md
code-intel analyze --skip-git
code-intel analyze --skip-folders tests examples
code-intel analyze --skip-files "*.generated.ts"
code-intel analyze --verbose
code-intel analyze --summarize
code-intel analyze --llm-provider <provider>
code-intel analyze --llm-model <model>
code-intel analyze --llm-base-url <url>
code-intel analyze --llm-api-key <key>
code-intel analyze --llm-batch-size <n>
code-intel analyze --llm-max-nodes <n>
code-intel analyze --no-group-sync
code-intel analyze --dry-run
code-intel analyze --max-memory <MB>
code-intel analyze --profile
```

In 1.0.9, a non-empty source change uses a correctness-first full graph rebuild. Vector maintenance is planned separately: unchanged vectors are preserved, while changed and deleted file vectors are updated.

## MCP, Web UI, and watcher

```bash
code-intel mcp [path]

code-intel serve [path]
code-intel serve [path] --port 4747
code-intel serve --force
code-intel serve --detach

code-intel stop [path]

code-intel watch [path]
code-intel watch [path] --port 4747
code-intel watch --force
```

`mcp` uses stdio. `serve` exposes the HTTP API and Web UI. `watch` starts the server and patches the live graph after file changes.

## Repository registry and index lifecycle

```bash
code-intel list
code-intel repo list
code-intel repo show <name>
code-intel repo rename <name> <new-name>
code-intel repo relink <name> <new-path>

code-intel status [path-or-name]

code-intel clean [path]
code-intel clean --purge
code-intel clean --all --force
```

There is no `code-intel repo remove` command in 1.0.9. Use `code-intel clean` to remove the index and registry entry.

## Search and exploration

```bash
code-intel search "<query>" --limit 20 --path .
code-intel search "<query>" --json

code-intel inspect <symbol> --path .
code-intel inspect <symbol> --json

code-intel impact <symbol> --path .
code-intel impact <symbol> --depth 5

code-intel context <symbols...> --show-context
code-intel context <symbols...> --intent auto
code-intel context <symbols...> --limit 10

code-intel query 'FIND function WHERE name CONTAINS "auth"'
code-intel query --file query.gql
code-intel query --format json
```

Recommended sequence:

```text
search → inspect → impact → context → change → detect changes → suggest tests
```

## Repository groups

```bash
code-intel group create <name>
code-intel group add <group> <group-path> <registry-name>
code-intel group remove <group> <group-path>
code-intel group list [name]
code-intel group sync <name>
code-intel group sync <name> --dry-run
code-intel group contracts <name>
code-intel group contracts <name> --kind route
code-intel group contracts <name> --repo <repo>
code-intel group contracts <name> --min-confidence 70
code-intel group query <name> "<query>" --limit 10
code-intel group status <name>
code-intel group init-workspace [path]
code-intel group init-workspace --name <name>
code-intel group init-workspace --no-analyze
code-intel group init-workspace --yes
code-intel group init-workspace --parallel 2
```

There is no `code-intel group delete` command in 1.0.9.

## Quality and security

```bash
code-intel health [path]
code-intel health --dead-code
code-intel health --cycles
code-intel health --orphans

code-intel deprecated [path] --format table

code-intel complexity [path] --top 20
code-intel complexity --threshold 10
code-intel complexity --format json

code-intel coverage [path]
code-intel coverage --threshold 80
code-intel coverage --scope src/api
code-intel coverage --format json

code-intel secrets [path]
code-intel secrets --fail-on
code-intel secrets --fix-hint
code-intel secrets --format json

code-intel scan [path]
code-intel scan --type secrets,sql,xss,ssrf,path,cmd
code-intel scan --severity high
code-intel scan --format json
code-intel scan --format sarif
```

## Users, tokens, authentication, and secrets

```bash
code-intel user create <username> --role <role>
code-intel user list
code-intel user reset-password <username>
code-intel user set-role <username> <role>

code-intel token create --name <name> --role <role>
code-intel token create --expires 90d
code-intel token create --repos api-core,worker
code-intel token list
code-intel token revoke <id>

code-intel auth login
code-intel auth login --server http://localhost:4747
code-intel auth logout
code-intel auth rotate-token <id>

code-intel keystore set <key> <value>
code-intel keystore get <key>
code-intel keystore delete <key>
code-intel keystore list
code-intel keystore backend

code-intel config-validate <file>
```

## Backup and migrations

```bash
code-intel backup create [path]
code-intel backup list
code-intel backup restore <id>
code-intel backup restore <id> --target <path>

code-intel migrate
code-intel migrate --status
code-intel migrate --dry-run
code-intel migrate --rollback
code-intel migrate --db <path>
```

## Diagnostics and update

```bash
code-intel doctor
code-intel update
code-intel update --yes
code-intel --version
code-intel --help
code-intel --debug <command>
```

## Advanced standalone commands

These are implemented before Commander dispatch and may not appear in the main help table.

```bash
code-intel index-status [path]
code-intel index-status [path] --upgrade-legacy

code-intel change-context [path] --files src/a.ts,src/b.ts
code-intel change-context [path] --diff-file change.diff
code-intel change-context [path] --max-hops 3
code-intel change-context [path] --max-tokens 6000
code-intel change-context [path] --max-symbols 50

code-intel change-context-mcp [path]

code-intel change-context-http [path]
code-intel change-context-http [path] --host 127.0.0.1 --port 30128
```

Use `index-status` for index trust checks and `change-context` when CI already knows the changed files or has a unified diff.