/**
 * Shell completion scripts for code-intel CLI.
 *
 * Generates static bash/zsh/fish completion scripts with dynamic
 * completion for repo paths and group names from ~/.code-intel/.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const GLOBAL_DIR = path.join(os.homedir(), '.code-intel');

// ── Dynamic data helpers ──────────────────────────────────────────────────────

function loadRepoPaths(): string[] {
  try {
    const data = fs.readFileSync(path.join(GLOBAL_DIR, 'repos.json'), 'utf-8');
    const repos = JSON.parse(data) as Array<{ path: string }>;
    return repos.map((r) => r.path);
  } catch {
    return [];
  }
}

function loadGroupNames(): string[] {
  const groupsDir = path.join(GLOBAL_DIR, 'groups');
  try {
    return fs.readdirSync(groupsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

// ── Bash completion ───────────────────────────────────────────────────────────

function bashCompletion(): string {
  const repoPaths = loadRepoPaths().join(' ');
  const groupNames = loadGroupNames().join(' ');

  return `# code-intel bash completion
# Source this file or add to ~/.bashrc:
#   source <(code-intel completion bash)

_code_intel_complete() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=\${COMP_CWORD}
  }

  local commands="init config setup analyze mcp serve watch list status clean search inspect impact deprecated group user token backup migrate auth keystore health query pr-impact complexity coverage secrets scan doctor completion update"
  local config_subcommands="get set list validate reset"
  local group_subcommands="create add remove list sync contracts query status"
  local repo_paths="${repoPaths}"
  local group_names="${groupNames}"

  # Sub-command completion
  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  local command="\${words[1]}"

  case "\${command}" in
    config)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( \$(compgen -W "\${config_subcommands}" -- "\${cur}") )
      elif [[ \${cword} -eq 3 && "\${words[2]}" =~ ^(get|set)$ ]]; then
        local keys="llm.provider llm.model llm.apiKey llm.batchSize llm.maxTokensPerSummary embeddings.model embeddings.enabled analysis.maxFileSizeKB analysis.ignorePatterns analysis.incrementalByDefault serve.defaultPort serve.openBrowser auth.mode updates.checkOnStartup updates.intervalHours telemetry.enabled"
        COMPREPLY=( \$(compgen -W "\${keys}" -- "\${cur}") )
      fi
      ;;
    group)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( \$(compgen -W "\${group_subcommands}" -- "\${cur}") )
      elif [[ \${cword} -eq 3 && "\${words[2]}" =~ ^(sync|contracts|query|status|add|remove|list)$ ]]; then
        COMPREPLY=( \$(compgen -W "\${group_names}" -- "\${cur}") )
      fi
      ;;
    analyze|serve|watch|clean|status|mcp|search|inspect|impact|deprecated|health|query|pr-impact|complexity|coverage|secrets|scan)
      # Complete repo paths for commands that take a path argument
      if [[ "\${cur}" == /* || "\${cur}" == ./* || "\${cur}" == ~/* ]]; then
        COMPREPLY=( \$(compgen -d -- "\${cur}") )
      else
        COMPREPLY=( \$(compgen -W "\${repo_paths}" -- "\${cur}") \$(compgen -d -- "\${cur}") )
      fi
      ;;
    completion)
      COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
  esac

  return 0
}

complete -F _code_intel_complete code-intel
`;
}

// ── Zsh completion ────────────────────────────────────────────────────────────

function zshCompletion(): string {
  const repoPaths = loadRepoPaths();
  const groupNames = loadGroupNames();

  const repoPathArgs = repoPaths.map((p) => `'${p}'`).join(' ');
  const groupNameArgs = groupNames.map((g) => `'${g}'`).join(' ');

  return `#compdef code-intel
# code-intel zsh completion
# Add to ~/.zshrc:
#   source <(code-intel completion zsh)

_code_intel() {
  local state

  _arguments -C \\
    '(-V --version)'{-V,--version}'[output version number]' \\
    '--debug[show full stack traces]' \\
    '(-h --help)'{-h,--help}'[show help]' \\
    '1: :_code_intel_commands' \\
    '*:: :->args'

  case \$state in
    args)
      case \$words[1] in
        config)
          _arguments '1: :(get set list validate reset)' \\
            '2: :_code_intel_config_keys'
          ;;
        group)
          _arguments '1: :(create add remove list sync contracts query status)' \\
            '2: :(${groupNameArgs})'
          ;;
        completion)
          _arguments '1: :(bash zsh fish)'
          ;;
        analyze|serve|watch|clean|status|mcp)
          _arguments '1: :(${repoPathArgs})' '*: :_files -/'
          ;;
        *)
          _files
          ;;
      esac
      ;;
  esac
}

_code_intel_commands() {
  local commands
  commands=(
    'init:Interactive setup wizard'
    'config:Get/set/list/validate/reset config'
    'setup:Configure MCP server for editors'
    'analyze:Index repository and build knowledge graph'
    'mcp:Start MCP stdio server'
    'serve:Start HTTP server + web UI'
    'watch:Start HTTP server + file watcher'
    'list:List indexed repositories'
    'status:Show index freshness'
    'clean:Remove index for a repository'
    'search:Search the knowledge graph'
    'inspect:Inspect a symbol'
    'impact:Show blast radius for a symbol'
    'deprecated:Find deprecated API usages'
    'group:Manage repository groups'
    'health:Run code health checks'
    'query:Execute GQL query'
    'pr-impact:Compute PR blast radius'
    'complexity:Show complexity hotspots'
    'coverage:Show untested symbols'
    'secrets:Scan for hardcoded secrets'
    'scan:Run security scans'
    'doctor:Run diagnostics'
    'update:Self-update code-intel'
    'completion:Generate shell completion script'
  )
  _describe 'command' commands
}

_code_intel_config_keys() {
  local keys
  keys=(
    'llm.provider:LLM provider (openai/anthropic/ollama/none)'
    'llm.model:LLM model name'
    'llm.apiKey:API key (use \\$ENV_VAR syntax)'
    'llm.batchSize:Concurrent LLM calls per batch'
    'embeddings.enabled:Enable vector search'
    'serve.defaultPort:Default HTTP server port'
    'serve.openBrowser:Auto-open browser on serve'
    'auth.mode:Auth mode (local/oidc)'
    'updates.checkOnStartup:Check for updates on startup'
    'telemetry.enabled:Enable telemetry'
  )
  _describe 'config key' keys
}

_code_intel "\$@"
`;
}

// ── Fish completion ───────────────────────────────────────────────────────────

function fishCompletion(): string {
  const repoPaths = loadRepoPaths();
  const groupNames = loadGroupNames();

  const repoLines = repoPaths
    .map((p) => `complete -c code-intel -n '__fish_code_intel_needs_path' -a '${p}' -d 'Indexed repo'`)
    .join('\n');

  const groupLines = groupNames
    .map((g) => `complete -c code-intel -n '__fish_seen_subcommand_from group; and __fish_seen_subcommand_from sync contracts query status add remove' -a '${g}' -d 'Group'`)
    .join('\n');

  return `# code-intel fish completion
# Save to ~/.config/fish/completions/code-intel.fish
# Or run: code-intel completion fish > ~/.config/fish/completions/code-intel.fish

function __fish_code_intel_needs_path
  set -l cmd (commandline -poc)
  if string match -qr '^code-intel (analyze|serve|watch|clean|status|mcp)' -- (string join ' ' $cmd)
    return 0
  end
  return 1
end

function __fish_code_intel_using_subcommand
  set -l cmd (commandline -poc)
  set -l subcmd $argv[1]
  string match -qr "code-intel $subcmd" -- (string join ' ' $cmd)
end

# Top-level commands
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'init' -d 'Interactive setup wizard'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'config' -d 'Get/set/list/validate/reset config'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'setup' -d 'Configure MCP server for editors'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'analyze' -d 'Index repository and build knowledge graph'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'serve' -d 'Start HTTP server + web UI'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'search' -d 'Search the knowledge graph'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'inspect' -d 'Inspect a symbol'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'impact' -d 'Show blast radius for a symbol'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'group' -d 'Manage repository groups'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'doctor' -d 'Run diagnostics'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'update' -d 'Self-update code-intel'
complete -c code-intel -f -n 'not __fish_seen_subcommand_from init config setup analyze mcp serve watch list status clean search inspect impact deprecated group health query pr-impact complexity coverage secrets scan doctor update completion' -a 'completion' -d 'Generate shell completion script'

# config subcommands
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list validate reset' -a 'get' -d 'Print a config value'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list validate reset' -a 'set' -d 'Update a config value'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list validate reset' -a 'list' -d 'Print full config (masked)'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list validate reset' -a 'validate' -d 'Validate config'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and not __fish_seen_subcommand_from get set list validate reset' -a 'reset' -d 'Reset to defaults'

# config keys for get/set
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'llm.provider' -d 'LLM provider'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'llm.model' -d 'LLM model name'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'llm.apiKey' -d 'LLM API key'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'embeddings.enabled' -d 'Enable vector search'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'serve.defaultPort' -d 'Default port'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'serve.openBrowser' -d 'Auto-open browser'
complete -c code-intel -f -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set' -a 'auth.mode' -d 'Auth mode'

# group subcommands
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'create' -d 'Create a group'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'add' -d 'Add repo to group'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'remove' -d 'Remove repo from group'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'list' -d 'List groups'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'sync' -d 'Sync group contracts'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'contracts' -d 'View contracts'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'query' -d 'Query across group'
complete -c code-intel -f -n '__fish_seen_subcommand_from group; and not __fish_seen_subcommand_from create add remove list sync contracts query status' -a 'status' -d 'Group health status'

# completion subcommands
complete -c code-intel -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# Dynamic repo paths
${repoLines}

# Dynamic group names
${groupLines}

# Global flags
complete -c code-intel -l debug -d 'Show full stack traces'
complete -c code-intel -l version -s V -d 'Show version'
complete -c code-intel -l help -s h -d 'Show help'
`;
}

// ── Auto-install ──────────────────────────────────────────────────────────────

function detectShell(): string | null {
  const shell = process.env.SHELL ?? '';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  return null;
}

export function autoInstallCompletion(): void {
  const shell = detectShell();
  if (!shell) {
    console.error('  ✗  Could not detect shell. Run `code-intel completion bash|zsh|fish` manually.\n');
    return;
  }

  console.log(`  Detected shell: ${shell}`);

  if (shell === 'fish') {
    const dir = path.join(os.homedir(), '.config', 'fish', 'completions');
    const dest = path.join(dir, 'code-intel.fish');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, fishCompletion(), 'utf-8');
    console.log(`  ✅  Fish completion installed → ${dest}\n`);
    return;
  }

  const script = shell === 'zsh'
    ? `\nsource <(code-intel completion zsh)\n`
    : `\nsource <(code-intel completion bash)\n`;

  const rcFile = shell === 'zsh'
    ? path.join(os.homedir(), '.zshrc')
    : path.join(os.homedir(), '.bashrc');

  try {
    const existing = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf-8') : '';
    if (existing.includes('code-intel completion')) {
      console.log(`  ℹ  Completion already configured in ${rcFile}\n`);
      return;
    }
    fs.appendFileSync(rcFile, script, 'utf-8');
    console.log(`  ✅  ${shell} completion added to ${rcFile}`);
    console.log(`     Restart your shell or run: source ${rcFile}\n`);
  } catch (err) {
    console.error(`  ✗  Could not write to ${rcFile}: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function generateCompletion(shell: 'bash' | 'zsh' | 'fish'): string {
  switch (shell) {
    case 'bash': return bashCompletion();
    case 'zsh':  return zshCompletion();
    case 'fish': return fishCompletion();
  }
}
