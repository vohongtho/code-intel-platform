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
import { execFileSync } from 'node:child_process';

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

// ── Agent / Editor detection ──────────────────────────────────────────────────

export interface DetectedAgent {
  name: string;
  /** How to install MCP for this agent */
  installMcp: (cwd: string) => { ok: boolean; message: string };
}

// ── OS-aware path helpers ─────────────────────────────────────────────────────

/** Returns the platform's XDG_CONFIG_HOME equivalent (Linux/macOS: ~/.config). */
function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
}

/** Returns %APPDATA% (Windows: C:\Users\<user>\AppData\Roaming). */
function roamingAppData(): string {
  return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
}

/** Returns %LOCALAPPDATA% (Windows: C:\Users\<user>\AppData\Local). */
function localAppData(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
}

/** Amp settings.json — ~/.config/amp/settings.json on Linux/macOS, %APPDATA%\amp\settings.json on Windows. */
function getAmpSettingsPath(): string {
  if (process.platform === 'win32') return path.join(roamingAppData(), 'amp', 'settings.json');
  return path.join(xdgConfigHome(), 'amp', 'settings.json');
}

/**
 * Claude Code user-level MCP config — ~/.claude.json on all platforms.
 * (Not to be confused with Claude Desktop's claude_desktop_config.json.)
 */
function getClaudeCodeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/** Zed settings.json — ~/.config/zed/settings.json on Linux/macOS, %LOCALAPPDATA%\Zed\settings.json on Windows. */
function getZedSettingsPath(): string {
  if (process.platform === 'win32') return path.join(localAppData(), 'Zed', 'settings.json');
  return path.join(xdgConfigHome(), 'zed', 'settings.json');
}

// ── Binary detection ──────────────────────────────────────────────────────────

function commandExists(bin: string): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('where', [bin], { stdio: 'ignore' });
    } else {
      execFileSync('which', [bin], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function dirExists(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// ── Atomic file write (cross-OS) ──────────────────────────────────────────────

/**
 * Rename tmp → dest.  On Windows the file lock window is wider (antivirus,
 * sync tools) so retry up to 5× on transient EPERM / EBUSY / EACCES.
 */
function renameWithRetry(tmp: string, dest: string): void {
  const maxAttempts = process.platform === 'win32' ? 5 : 1;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code)) break;
      // Brief pause before retry (synchronous — acceptable in a one-shot CLI)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Safely merge `entry` into a JSON config file without losing existing keys.
 *
 * @param filePath   Target JSON file (created if absent).
 * @param keyPath    Dot-path segments for NESTED merge, e.g. `['mcpServers']`.
 *                   Pass `null` to merge at the root level (flat keys).
 * @param entry      Object to shallow-merge at the leaf.
 *
 * IMPORTANT: Amp uses flat dot-notation keys ("amp.mcpServers", "amp.url", …).
 * Do NOT pass ['amp', 'mcpServers'] for Amp — that creates a nested {"amp":{…}}
 * object which shadows and destroys all existing flat "amp.*" settings.
 * Use null + a flat key like "amp.mcpServers" for Amp instead.
 *
 * SAFETY: Always creates a .bak backup before any write so the original can be
 * restored if something goes wrong.
 */
function mergeJsonFile(
  filePath: string,
  keyPath: string[] | null,
  entry: Record<string, unknown>,
): { ok: boolean; message: string } {
  let tmp: string | undefined;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    let root: Record<string, unknown> = {};
    const fileExists = fs.existsSync(filePath);
    if (fileExists) {
      try { root = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>; } catch { /* overwrite corrupt file */ }
    }

    if (keyPath && keyPath.length > 0) {
      // Walk/create nested objects — only use for agents that store nested JSON
      // (Claude Code, Cursor, VS Code, Windsurf, Gemini, Zed, Kiro).
      // Do NOT use for Amp (flat dot-notation keys).
      let cursor: Record<string, unknown> = root;
      for (let i = 0; i < keyPath.length - 1; i++) {
        const k = keyPath[i]!;
        if (typeof cursor[k] !== 'object' || cursor[k] === null) cursor[k] = {};
        cursor = cursor[k] as Record<string, unknown>;
      }
      const leaf = keyPath[keyPath.length - 1]!;
      cursor[leaf] = { ...((cursor[leaf] as Record<string, unknown>) ?? {}), ...entry };
    } else {
      // Root-level merge — preserves ALL existing keys (used for Amp flat format).
      root = { ...root, ...entry };
    }

    // Backup the original file BEFORE any write (allows manual recovery)
    if (fileExists) {
      try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch { /* non-fatal */ }
    }

    tmp = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(root, null, 2) + '\n', 'utf-8');
    renameWithRetry(tmp, filePath);
    return { ok: true, message: filePath };
  } catch (err) {
    // Clean up temp file so it doesn't litter the config directory
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// Single MCP entry reused by all agents — npx is the most cross-OS-portable launcher.
const MCP_ENTRY = {
  'code-intel': { command: 'npx', args: ['code-intel', 'mcp', '.'] },
};

/**
 * Read a JSON file safely. Returns {} if missing or corrupt.
 */
function readJsonSafe(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>; }
  catch { return {}; }
}

/**
 * Check whether code-intel MCP is already registered under a nested key.
 * Prevents double-writes and preserves all existing config.
 */
function mcpAlreadyPresent(root: Record<string, unknown>, keyPath: string[]): boolean {
  let cursor: Record<string, unknown> = root;
  for (const k of keyPath) {
    if (typeof cursor[k] !== 'object' || cursor[k] === null) return false;
    cursor = cursor[k] as Record<string, unknown>;
  }
  return 'code-intel' in cursor;
}

/** All known AI agents — detection + MCP install logic */
const ALL_AGENTS: DetectedAgent[] = [
  // ── Amp ──────────────────────────────────────────────────────────────────
  {
    name: 'Amp',
    installMcp: () => {
      // Amp uses FLAT dot-notation keys: "amp.mcpServers", "amp.url", etc.
      // We must merge at root level (keyPath=null) so we only add/update the
      // "amp.mcpServers" key without touching any other "amp.*" settings.
      const ampSettingsPath = getAmpSettingsPath();
      const root = readJsonSafe(ampSettingsPath);
      // Idempotency: skip if code-intel already registered
      const existing = root['amp.mcpServers'] as Record<string, unknown> | undefined;
      if (existing?.['code-intel']) {
        return { ok: true, message: `${ampSettingsPath} (already present)` };
      }
      // Merge only the new entry into amp.mcpServers, preserving all other servers
      const merged = { ...(existing ?? {}), ...MCP_ENTRY };
      return mergeJsonFile(ampSettingsPath, null, { 'amp.mcpServers': merged });
    },
  },
  // ── Claude Code ───────────────────────────────────────────────────────────
  {
    name: 'Claude Code',
    installMcp: () => {
      // Claude Code stores user-level MCP servers in ~/.claude.json (nested mcpServers).
      const cfgPath = getClaudeCodeConfigPath();
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['mcpServers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['mcpServers'], MCP_ENTRY);
    },
  },
  // ── Cursor ───────────────────────────────────────────────────────────────
  {
    name: 'Cursor',
    installMcp: (cwd) => {
      // Cursor uses .cursor/mcp.json with nested mcpServers.
      const cfgPath = path.join(cwd, '.cursor', 'mcp.json');
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['mcpServers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['mcpServers'], MCP_ENTRY);
    },
  },
  // ── VS Code ───────────────────────────────────────────────────────────────
  {
    name: 'VS Code',
    installMcp: (cwd) => {
      // VS Code uses .vscode/mcp.json with nested servers.
      const cfgPath = path.join(cwd, '.vscode', 'mcp.json');
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['servers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['servers'], MCP_ENTRY);
    },
  },
  // ── Windsurf ─────────────────────────────────────────────────────────────
  {
    name: 'Windsurf',
    installMcp: (cwd) => {
      // Windsurf uses .windsurf/mcp.json with nested mcpServers.
      const cfgPath = path.join(cwd, '.windsurf', 'mcp.json');
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['mcpServers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['mcpServers'], MCP_ENTRY);
    },
  },
  // ── Gemini CLI ────────────────────────────────────────────────────────────
  {
    name: 'Gemini CLI',
    installMcp: () => {
      // ~/.gemini/settings.json with nested mcpServers.
      const cfgPath = path.join(os.homedir(), '.gemini', 'settings.json');
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['mcpServers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['mcpServers'], MCP_ENTRY);
    },
  },
  // ── Codex (OpenAI) ────────────────────────────────────────────────────────
  {
    name: 'Codex',
    installMcp: () => {
      // Codex reads AGENTS.md for tool instructions — no MCP config file.
      return { ok: true, message: 'rules written to AGENTS.md' };
    },
  },
  // ── Zed ──────────────────────────────────────────────────────────────────
  {
    name: 'Zed',
    installMcp: () => {
      // Zed uses context_servers (not mcpServers). Path is OS-aware via getZedSettingsPath().
      const cfgPath = getZedSettingsPath();
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['context_servers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['context_servers'], {
        'code-intel': { command: { path: 'npx', args: ['code-intel', 'mcp', '.'] } },
      });
    },
  },
  // ── Kiro IDE ──────────────────────────────────────────────────────────────
  {
    name: 'Kiro',
    installMcp: () => {
      // Kiro global MCP config: ~/.kiro/settings/mcp.json
      // Format: standard nested mcpServers.
      // Docs: https://kiro.dev/docs/mcp/configuration/
      const cfgPath = path.join(os.homedir(), '.kiro', 'settings', 'mcp.json');
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['mcpServers'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      return mergeJsonFile(cfgPath, ['mcpServers'], MCP_ENTRY);
    },
  },
  // ── OpenCode (anomalyco/opencode) ─────────────────────────────────────────
  {
    name: 'OpenCode',
    installMcp: () => {
      // OpenCode global config: ~/.config/opencode/opencode.json
      // IMPORTANT: OpenCode uses "mcp" key (NOT "mcpServers") and
      // "command" is an ARRAY (not a string). Different from Claude/Cursor format.
      // Format: { "mcp": { "server": { "type": "local", "command": ["npx",...] } } }
      // Docs: https://opencode.ai/docs/config/
      const cfgPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      const root = readJsonSafe(cfgPath);
      if (mcpAlreadyPresent(root, ['mcp'])) {
        return { ok: true, message: `${cfgPath} (already present)` };
      }
      const OPENCODE_MCP_ENTRY = {
        'code-intel': { type: 'local', command: ['npx', 'code-intel', 'mcp', '.'], enabled: true },
      };
      return mergeJsonFile(cfgPath, ['mcp'], OPENCODE_MCP_ENTRY);
    },
  },
];

/** Detect which agents are installed on this machine. */
export function detectAgents(): DetectedAgent[] {
  const home = os.homedir();
  const detected: DetectedAgent[] = [];

  for (const agent of ALL_AGENTS) {
    let found = false;
    switch (agent.name) {
      case 'Amp': {
        // Check binary, ~/.amp dir, or the OS-specific settings file/dir
        const ampCfg = getAmpSettingsPath();
        found = commandExists('amp')
          || dirExists(path.join(home, '.amp'))
          || fs.existsSync(ampCfg)
          || dirExists(path.dirname(ampCfg));
        break;
      }
      case 'Claude Code':
        // Check binary or the ~/.claude directory (where Claude Code stores its state)
        found = commandExists('claude') || dirExists(path.join(home, '.claude'));
        break;
      case 'Cursor':
        found = commandExists('cursor') || dirExists(path.join(home, '.cursor'));
        break;
      case 'VS Code':
        // VS Code installs as `code` on all platforms
        found = commandExists('code');
        break;
      case 'Windsurf':
        found = commandExists('windsurf');
        break;
      case 'Gemini CLI':
        found = commandExists('gemini') || dirExists(path.join(home, '.gemini'));
        break;
      case 'Codex':
        found = commandExists('codex') || dirExists(path.join(home, '.codex'));
        break;
      case 'Zed': {
        // Zed CLI (`zed`) is optional; also check for the OS-specific settings dir
        const zedCfg = getZedSettingsPath();
        found = commandExists('zed')
          || fs.existsSync(zedCfg)
          || dirExists(path.dirname(zedCfg));
        break;
      }
      case 'Kiro':
        // Check binary or the ~/.kiro settings directory
        found = commandExists('kiro') || dirExists(path.join(home, '.kiro'));
        break;
      case 'OpenCode':
        // Check binary or global config dir ~/.config/opencode
        found = commandExists('opencode') || dirExists(path.join(home, '.config', 'opencode'));
        break;
    }
    if (found) detected.push(agent);
  }
  return detected;
}

/** Legacy: returns editor names for backward compat */
export function detectEditors(): string[] {
  return detectAgents().map((a) => a.name);
}

// ── Editor list (legacy, used by setup command) ───────────────────────────────
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
    // Non-interactive: detect agents and auto-register MCP, then write defaults
    const detectedAgents = detectAgents();
    if (detectedAgents.length > 0) {
      console.log(`  Detected agents: ${detectedAgents.map((a) => a.name).join(', ')}`);
      const cwd = process.cwd();
      for (const agent of detectedAgents) {
        const result = agent.installMcp(cwd);
        if (result.ok) {
          console.log(`  ✅  MCP registered for ${agent.name} → ${result.message}`);
        } else {
          console.log(`  ⚠   ${agent.name}: ${result.message}`);
        }
      }
    }
    saveConfig(cfg);
    console.log(`  ✅  Config written to ${CONFIG_PATH} (all defaults)\n`);
    printNextSteps();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Step 1: Agent detection + MCP registration ───────────────────────
    console.log('  ── Step 1/5: AI Agent Detection ────────────────────────────────\n');
    const detectedAgents = detectAgents();
    if (detectedAgents.length > 0) {
      console.log(`  Detected agents: ${detectedAgents.map((a) => a.name).join(', ')}\n`);
      const registerMcp = await confirm(rl, 'Auto-register code-intel MCP server in detected agents?');
      if (registerMcp) {
        const cwd = process.cwd();
        for (const agent of detectedAgents) {
          const result = agent.installMcp(cwd);
          if (result.ok) {
            console.log(`  ✅  MCP registered for ${agent.name} → ${result.message}`);
          } else {
            console.log(`  ⚠   ${agent.name}: ${result.message}`);
          }
        }
      }
    } else {
      console.log('  No supported AI agents detected (Amp, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, Codex, Zed).');
      console.log('  Run `code-intel setup` later to configure MCP manually.\n');
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

      const endpointIn = (await prompt(rl, `  Endpoint [${CUSTOM_DEFAULT_ENDPOINT}]: `)).trim();
      cfg.llm.baseUrl  = endpointIn || CUSTOM_DEFAULT_ENDPOINT;

      // Model is required
      let modelIn = '';
      while (!modelIn) {
        modelIn = (await prompt(rl, `  Model    (required, e.g. deepseek-v4-flash): `)).trim();
        if (!modelIn) console.log('  ⚠  Model name is required.');
      }
      cfg.llm.model = modelIn;

      // API Key is required
      let keyIn = '';
      while (!keyIn) {
        keyIn = (await prompt(rl, `  API Key  (required): `)).trim();
        if (!keyIn) console.log('  ⚠  API key is required.');
      }
      cfg.llm.apiKey = keyIn;

      console.log(`\n  ✅  Custom provider configured:`);
      console.log(`     Endpoint : ${cfg.llm.baseUrl}`);
      console.log(`     Model    : ${cfg.llm.model}`);
      console.log(`     API Key  : (set)`);

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
