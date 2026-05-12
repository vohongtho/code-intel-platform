/**
 * code-intel init — Interactive first-run wizard
 *
 * Steps:
 *  1. Detect editors (VS Code, Cursor, Windsurf, Zed) → offer MCP registration
 *  2. LLM provider (OpenAI / Anthropic / Ollama / skip)
 *  3. Embeddings (enable vector search?)
 *  4. Auth mode (local only / + OIDC)
 *  5. Default port + open browser on serve
 *
 * Writes ~/.code-intel/config.json on completion.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { execSync } from 'node:child_process';

// ── Paths ────────────────────────────────────────────────────────────────────
const GLOBAL_DIR = path.join(os.homedir(), '.code-intel');
const CONFIG_PATH = path.join(GLOBAL_DIR, 'config.json');

// ── Default config ───────────────────────────────────────────────────────────
export interface CodeIntelConfig {
  $schema?: string;
  llm: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'custom' | 'none';
    model: string;
    apiKey: string;
    baseUrl?: string;
    batchSize: number;
    contextWindow?: number;
    maxTokensPerSummary: number;
  };
  embeddings: {
    model: string;
    enabled: boolean;
  };
  analysis: {
    maxFileSizeKB: number;
    ignorePatterns: string[];
    incrementalByDefault: boolean;
  };
  serve: {
    defaultPort: number;
    openBrowser: boolean;
  };
  auth: {
    mode: 'local' | 'oidc';
    oidc?: {
      issuerUrl: string;
      clientId: string;
      clientSecret: string;
    };
  };
  updates: {
    checkOnStartup: boolean;
    intervalHours: number;
  };
  telemetry: {
    enabled: boolean;
  };
}

export const DEFAULT_CONFIG: CodeIntelConfig = {
  $schema: 'https://code-intel.dev/config-schema.json',
  llm: {
    provider: 'ollama',
    model: 'llama3',
    apiKey: '',
    batchSize: 20,
    maxTokensPerSummary: 100,
  },
  embeddings: {
    model: 'all-MiniLM-L6-v2',
    enabled: false,
  },
  analysis: {
    maxFileSizeKB: 512,
    ignorePatterns: [],
    incrementalByDefault: false,
  },
  serve: {
    defaultPort: 4747,
    openBrowser: true,
  },
  auth: {
    mode: 'local',
  },
  updates: {
    checkOnStartup: true,
    intervalHours: 24,
  },
  telemetry: {
    enabled: false,
  },
};

// ── Config I/O ────────────────────────────────────────────────────────────────
export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function loadConfig(): CodeIntelConfig | null {
  if (!configExists()) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as CodeIntelConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: CodeIntelConfig): void {
  fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

export function wipeConfig(): void {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
}

// ── Editor detection ──────────────────────────────────────────────────────────
interface Editor {
  name: string;
  binaries: string[];
  configFile: (home: string) => string;
  mcpConfigKey: string;
}

const EDITORS: Editor[] = [
  {
    name: 'VS Code',
    binaries: ['code'],
    configFile: (home) => {
      const platform = process.platform;
      if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
      if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
      return path.join(home, '.config', 'Code', 'User', 'settings.json');
    },
    mcpConfigKey: '.vscode/mcp.json',
  },
  {
    name: 'Cursor',
    binaries: ['cursor'],
    configFile: (home) => {
      const platform = process.platform;
      if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
      if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'settings.json');
      return path.join(home, '.config', 'Cursor', 'User', 'settings.json');
    },
    mcpConfigKey: '.cursor/mcp.json',
  },
  {
    name: 'Windsurf',
    binaries: ['windsurf'],
    configFile: (home) => {
      if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Windsurf', 'User', 'settings.json');
      return path.join(home, '.config', 'Windsurf', 'User', 'settings.json');
    },
    mcpConfigKey: '.windsurf/mcp.json',
  },
  {
    name: 'Zed',
    binaries: ['zed'],
    configFile: (home) => path.join(home, '.config', 'zed', 'settings.json'),
    mcpConfigKey: '.zed/mcp.json',
  },
];

function commandExists(bin: string): boolean {
  try {
    execSync(`which ${bin} 2>/dev/null || where ${bin} 2>nul`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function detectEditors(): string[] {
  return EDITORS
    .filter((e) => e.binaries.some(commandExists))
    .map((e) => e.name);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return rl.question(question);
}

async function confirm(rl: ReturnType<typeof createInterface>, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const ans = (await prompt(rl, `  ${question} ${hint}: `)).trim().toLowerCase();
  if (ans === '') return defaultYes;
  return ans === 'y' || ans === 'yes';
}

async function choose<T extends string>(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options: { label: string; value: T }[],
  defaultIndex = 0,
): Promise<T> {
  console.log(`\n  ${question}`);
  options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}${i === defaultIndex ? '  (default)' : ''}`));
  while (true) {
    const ans = (await prompt(rl, `  Choice [${defaultIndex + 1}]: `)).trim();
    if (ans === '') return options[defaultIndex].value;
    const idx = parseInt(ans, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx].value;
    console.log('  Invalid choice. Try again.');
  }
}

// ── Main wizard ───────────────────────────────────────────────────────────────
export async function runInitWizard(opts: { reset?: boolean; yes?: boolean } = {}): Promise<void> {
  const { reset = false, yes = false } = opts;

  console.log('\n  ◈  Code Intelligence Platform — Setup Wizard\n');
  console.log('  This wizard configures ~/.code-intel/config.json for your environment.\n');

  // ── Existing config check ─────────────────────────────────────────────────
  if (configExists() && !reset) {
    if (yes) {
      console.log(`  Config already exists at ${CONFIG_PATH}. Use --reset to overwrite.\n`);
      process.exit(0);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const doReset = await confirm(rl, `Config already exists at ${CONFIG_PATH}. Reset and re-run wizard?`, false);
    rl.close();
    if (!doReset) {
      console.log('\n  Keeping existing config. Run `code-intel init --reset` to overwrite.\n');
      process.exit(0);
    }
    wipeConfig();
    console.log('  Existing config removed.\n');
  }

  const cfg: CodeIntelConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CodeIntelConfig;

  if (yes) {
    // Non-interactive: write defaults
    saveConfig(cfg);
    console.log(`  ✅  Config written to ${CONFIG_PATH} (all defaults)\n`);
    printNextSteps();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Step 1: Editor detection + MCP registration ───────────────────────
    console.log('  ── Step 1/5: Editor Detection ──────────────────────────────────\n');
    const found = detectEditors();
    if (found.length > 0) {
      console.log(`  Detected editors: ${found.join(', ')}`);
      const registerMcp = await confirm(rl, 'Register code-intel MCP server in detected editors?');
      if (registerMcp) {
        for (const name of found) {
          const editor = EDITORS.find((e) => e.name === name)!;
          const mcpConfig = {
            servers: {
              'code-intel': { type: 'stdio', command: 'npx', args: ['code-intel', 'mcp', '.'] },
            },
          };
          const mcpFile = path.resolve(editor.mcpConfigKey);
          try {
            let existing: Record<string, unknown> = {};
            if (fs.existsSync(mcpFile)) {
              existing = JSON.parse(fs.readFileSync(mcpFile, 'utf-8')) as Record<string, unknown>;
            }
            const merged = {
              ...existing,
              servers: {
                ...((existing.servers as Record<string, unknown>) ?? {}),
                ...mcpConfig.servers,
              },
            };
            fs.mkdirSync(path.dirname(mcpFile), { recursive: true });
            fs.writeFileSync(mcpFile, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
            console.log(`  ✅  MCP registered for ${name} → ${editor.mcpConfigKey}`);
          } catch {
            console.log(`  ⚠   Could not write MCP config for ${name} — do it manually.`);
          }
        }
      }
    } else {
      console.log('  No supported editors detected (VS Code, Cursor, Windsurf, Zed).');
      console.log('  Run `code-intel setup` later to configure MCP manually.');
    }

    // ── Step 2: LLM provider ──────────────────────────────────────────────
    console.log('\n  ── Step 2/5: LLM Provider ──────────────────────────────────────\n');
    console.log('  Used for AI summaries (code-intel analyze --summarize) and chat.');
    const llmProvider = await choose(rl, 'Select LLM provider:', [
      { label: 'Ollama (local, free, requires Ollama running)', value: 'ollama' as const },
      { label: 'OpenAI (requires OPENAI_API_KEY env var)', value: 'openai' as const },
      { label: 'Anthropic (requires ANTHROPIC_API_KEY env var)', value: 'anthropic' as const },
      { label: 'Custom (OpenAI-compatible API — enter URL, token & model)', value: 'custom' as const },
      { label: 'Skip (configure later)', value: 'none' as const },
    ], 0);

    cfg.llm.provider = llmProvider;

    if (llmProvider === 'openai') {
      console.log('');
      const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1';
      const OPENAI_DEFAULT_MODEL    = 'gpt-4o-mini';
      const OPENAI_DEFAULT_KEY      = '$OPENAI_API_KEY';

      const endpointIn = (await prompt(rl, `  Endpoint [${OPENAI_DEFAULT_ENDPOINT}]: `)).trim();
      cfg.llm.baseUrl  = endpointIn || OPENAI_DEFAULT_ENDPOINT;

      const modelIn    = (await prompt(rl, `  Model    [${OPENAI_DEFAULT_MODEL}]: `)).trim();
      cfg.llm.model    = modelIn || OPENAI_DEFAULT_MODEL;

      const keyIn      = (await prompt(rl, `  API Key  [${OPENAI_DEFAULT_KEY}]: `)).trim();
      cfg.llm.apiKey   = keyIn || OPENAI_DEFAULT_KEY;

      console.log(`\n  ✅  OpenAI configured:`);
      console.log(`     Endpoint : ${cfg.llm.baseUrl}`);
      console.log(`     Model    : ${cfg.llm.model}`);
      console.log(`     API Key  : ${cfg.llm.apiKey.startsWith('$') ? cfg.llm.apiKey : '(set)'}`);

    } else if (llmProvider === 'anthropic') {
      console.log('');
      const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1';
      const ANTHROPIC_DEFAULT_MODEL    = 'claude-haiku-4-5';
      const ANTHROPIC_DEFAULT_KEY      = '$ANTHROPIC_API_KEY';

      const endpointIn = (await prompt(rl, `  Endpoint [${ANTHROPIC_DEFAULT_ENDPOINT}]: `)).trim();
      cfg.llm.baseUrl  = endpointIn || ANTHROPIC_DEFAULT_ENDPOINT;

      const modelIn    = (await prompt(rl, `  Model    [${ANTHROPIC_DEFAULT_MODEL}]: `)).trim();
      cfg.llm.model    = modelIn || ANTHROPIC_DEFAULT_MODEL;

      const keyIn      = (await prompt(rl, `  API Key  [${ANTHROPIC_DEFAULT_KEY}]: `)).trim();
      cfg.llm.apiKey   = keyIn || ANTHROPIC_DEFAULT_KEY;

      console.log(`\n  ✅  Anthropic configured:`);
      console.log(`     Endpoint : ${cfg.llm.baseUrl}`);
      console.log(`     Model    : ${cfg.llm.model}`);
      console.log(`     API Key  : ${cfg.llm.apiKey.startsWith('$') ? cfg.llm.apiKey : '(set)'}`);

    } else if (llmProvider === 'ollama') {
      console.log('');
      const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434';
      const OLLAMA_DEFAULT_MODEL    = 'llama3';

      const endpointIn = (await prompt(rl, `  Endpoint [${OLLAMA_DEFAULT_ENDPOINT}]: `)).trim();
      cfg.llm.baseUrl  = endpointIn || OLLAMA_DEFAULT_ENDPOINT;

      const modelIn    = (await prompt(rl, `  Model    [${OLLAMA_DEFAULT_MODEL}]: `)).trim();
      cfg.llm.model    = modelIn || OLLAMA_DEFAULT_MODEL;

      cfg.llm.apiKey   = '';

      console.log(`\n  ✅  Ollama configured:`);
      console.log(`     Endpoint : ${cfg.llm.baseUrl}`);
      console.log(`     Model    : ${cfg.llm.model}`);
      console.log(`     API Key  : (not required)`);
      console.log(`\n  Make sure Ollama is running: https://ollama.com`);
      console.log(`  Pull model with: ollama pull ${cfg.llm.model}`);

    } else if (llmProvider === 'custom') {
      console.log('\n  Configure your OpenAI-compatible provider (e.g. LM Studio, vLLM, DeepSeek, Groq, Together, Azure).\n');
      const CUSTOM_DEFAULT_ENDPOINT = 'http://localhost:1234/v1';
      const CUSTOM_DEFAULT_MODEL    = 'default';

      const endpointIn = (await prompt(rl, `  Endpoint [${CUSTOM_DEFAULT_ENDPOINT}]: `)).trim();
      cfg.llm.baseUrl  = endpointIn || CUSTOM_DEFAULT_ENDPOINT;

      const modelIn    = (await prompt(rl, `  Model    [${CUSTOM_DEFAULT_MODEL}]: `)).trim();
      cfg.llm.model    = modelIn || CUSTOM_DEFAULT_MODEL;

      const keyIn      = (await prompt(rl, `  API Key  (leave blank if not required): `)).trim();
      cfg.llm.apiKey   = keyIn || '';

      console.log(`\n  ✅  Custom provider configured:`);
      console.log(`     Endpoint : ${cfg.llm.baseUrl}`);
      console.log(`     Model    : ${cfg.llm.model}`);
      console.log(`     API Key  : ${cfg.llm.apiKey ? '(set)' : '(none)'}`);

    } else {
      cfg.llm.apiKey = '';
      console.log('  Skipped. Run `code-intel config set llm.provider openai` later.');
    }

    // ── Step 3: Embeddings ────────────────────────────────────────────────
    console.log('\n  ── Step 3/5: Vector Embeddings ─────────────────────────────────\n');
    console.log('  Enables semantic (natural-language) search. Slower to index, but more powerful.');
    const enableEmbeddings = await confirm(rl, 'Enable vector embeddings for semantic search?', false);
    cfg.embeddings.enabled = enableEmbeddings;
    if (enableEmbeddings) {
      console.log('  Embeddings enabled. Use --embeddings flag when running analyze.');
    } else {
      console.log('  Embeddings disabled. Use --embeddings to enable per-run.');
    }

    // ── Step 4: Auth mode ─────────────────────────────────────────────────
    console.log('\n  ── Step 4/5: Authentication Mode ───────────────────────────────\n');
    const authMode = await choose(rl, 'Select authentication mode for the web UI:', [
      { label: 'Local only (no login required, private use)', value: 'local' as const },
      { label: 'OIDC (team use, requires OIDC provider config)', value: 'oidc' as const },
    ], 0);
    cfg.auth.mode = authMode;

    if (authMode === 'oidc') {
      const issuerUrl = (await prompt(rl, '  OIDC Issuer URL: ')).trim();
      const clientId = (await prompt(rl, '  OIDC Client ID: ')).trim();
      cfg.auth.oidc = {
        issuerUrl: issuerUrl || 'https://your-oidc-provider.example.com',
        clientId: clientId || 'code-intel',
        clientSecret: '$OIDC_CLIENT_SECRET',
      };
      console.log('  Client secret will be read from $OIDC_CLIENT_SECRET env var.');
    } else {
      console.log('  Local-only mode: no authentication required for the web UI.');
    }

    // ── Step 5: Port + browser ────────────────────────────────────────────
    console.log('\n  ── Step 5/5: Server Settings ───────────────────────────────────\n');
    const portInput = (await prompt(rl, `  Default server port [${cfg.serve.defaultPort}]: `)).trim();
    if (portInput) {
      const port = parseInt(portInput, 10);
      if (Number.isFinite(port) && port > 0 && port < 65536) {
        cfg.serve.defaultPort = port;
      } else {
        console.log(`  Invalid port, keeping default ${cfg.serve.defaultPort}.`);
      }
    }
    cfg.serve.openBrowser = await confirm(rl, 'Open browser automatically when running `code-intel serve`?', true);

    // ── Write config ──────────────────────────────────────────────────────
    console.log('\n  ── Writing config ──────────────────────────────────────────────\n');
    saveConfig(cfg);
    console.log(`  ✅  Config written to ${CONFIG_PATH}\n`);

  } finally {
    rl.close();
  }

  printNextSteps();
}

function printNextSteps(): void {
  console.log('  ── Next Steps ──────────────────────────────────────────────────\n');
  console.log('  1.  Index your project:');
  console.log('        code-intel analyze\n');
  console.log('  2.  Start the web UI:');
  console.log('        code-intel serve\n');
  console.log('  3.  (Optional) Add AI summaries:');
  console.log('        code-intel analyze --summarize\n');
  console.log('  Docs: https://github.com/vohongtho/code-intel-platform\n');
}
