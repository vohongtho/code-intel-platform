import path from 'node:path';
import type { AgentTargetConfig } from '../storage/metadata.js';

export type AgentSetupIntegrationId =
  | 'claude-hook'
  | 'cursor-hook'
  | 'gemini-hook'
  | 'opencode-plugin';

export interface AgentOption {
  id: string;
  label: string;
  builtinTarget?: AgentTargetConfig;
  setupIntegrations?: AgentSetupIntegrationId[];
}

export const AGENT_OPTIONS: AgentOption[] = [
  { id: 'amazon-q-developer', label: 'Amazon Q Developer' },
  { id: 'antigravity', label: 'Antigravity', builtinTarget: { agentId: 'antigravity', label: 'Antigravity', path: '.agents/rules/code-intel-rules.md', format: 'markdown', builtin: true } },
  { id: 'auggie', label: 'Auggie (Augment CLI)' },
  { id: 'bob-shell', label: 'Bob Shell' },
  { id: 'claude', label: 'Claude Code', builtinTarget: { agentId: 'claude', label: 'Claude Code', path: 'CLAUDE.md', format: 'markdown', builtin: true }, setupIntegrations: ['claude-hook'] },
  { id: 'cline', label: 'Cline', builtinTarget: { agentId: 'cline', label: 'Cline', path: '.clinerules', format: 'markdown', builtin: true } },
  { id: 'codex', label: 'Codex', builtinTarget: { agentId: 'codex', label: 'Codex', path: 'AGENTS.md', format: 'markdown', builtin: true } },
  { id: 'forgecode', label: 'ForgeCode' },
  { id: 'codebuddy-code', label: 'CodeBuddy Code (CLI)' },
  { id: 'continue', label: 'Continue' },
  { id: 'costrict', label: 'CoStrict' },
  { id: 'crush', label: 'Crush' },
  { id: 'cursor', label: 'Cursor', builtinTarget: { agentId: 'cursor', label: 'Cursor', path: '.cursor/rules/code-intel.mdc', format: 'markdown', builtin: true }, setupIntegrations: ['cursor-hook'] },
  { id: 'factory-droid', label: 'Factory Droid' },
  { id: 'gemini-cli', label: 'Gemini CLI', setupIntegrations: ['gemini-hook'] },
  { id: 'copilot', label: 'GitHub Copilot', builtinTarget: { agentId: 'copilot', label: 'GitHub Copilot', path: '.github/copilot-instructions.md', format: 'markdown', builtin: true } },
  { id: 'iflow', label: 'iFlow' },
  { id: 'junie', label: 'Junie' },
  { id: 'kilocode', label: 'Kilo Code', builtinTarget: { agentId: 'kilocode', label: 'Kilo Code', path: 'AGENTS.md', format: 'markdown', builtin: true } },
  { id: 'kimi-cli', label: 'Kimi CLI' },
  { id: 'kiro', label: 'Kiro', builtinTarget: { agentId: 'kiro', label: 'Kiro', path: '.kiro/steering/code-intel.md', format: 'markdown', builtin: true } },
  { id: 'lingma', label: 'Lingma' },
  { id: 'mistral-vibe', label: 'Mistral Vibe' },
  { id: 'opencode', label: 'OpenCode', setupIntegrations: ['opencode-plugin'] },
  { id: 'pi', label: 'Pi' },
  { id: 'qoder', label: 'Qoder' },
  { id: 'qwen-code', label: 'Qwen Code' },
  { id: 'roocode', label: 'RooCode', builtinTarget: { agentId: 'roocode', label: 'RooCode', path: '.clinerules', format: 'markdown', builtin: true } },
  { id: 'trae', label: 'Trae' },
  { id: 'windsurf', label: 'Windsurf', builtinTarget: { agentId: 'windsurf', label: 'Windsurf', path: '.windsurfrules', format: 'markdown', builtin: true } },
];

export const LEGACY_CONTEXT_TARGETS: AgentTargetConfig[] = [
  { agentId: 'codex', label: 'Codex', path: 'AGENTS.md', format: 'markdown', builtin: true },
  { agentId: 'claude', label: 'Claude Code', path: 'CLAUDE.md', format: 'markdown', builtin: true },
  { agentId: 'copilot', label: 'GitHub Copilot', path: '.github/copilot-instructions.md', format: 'markdown', builtin: true },
  { agentId: 'cursor', label: 'Cursor', path: '.cursor/rules/code-intel.mdc', format: 'markdown', builtin: true },
  { agentId: 'kiro', label: 'Kiro', path: '.kiro/steering/code-intel.md', format: 'markdown', builtin: true },
  { agentId: 'cline', label: 'Cline', path: '.clinerules', format: 'markdown', builtin: true },
  { agentId: 'windsurf', label: 'Windsurf', path: '.windsurfrules', format: 'markdown', builtin: true },
  { agentId: 'kilocode-legacy', label: 'Kilo Code', path: '.kilocode/rules/code-intel-rules.md', format: 'markdown', builtin: true },
  { agentId: 'antigravity', label: 'Antigravity', path: '.agents/rules/code-intel-rules.md', format: 'markdown', builtin: true },
];

export function getAgentOption(agentId: string): AgentOption | undefined {
  return AGENT_OPTIONS.find((agent) => agent.id === agentId);
}

export function resolveBuiltinTarget(agentId: string): AgentTargetConfig | null {
  return getAgentOption(agentId)?.builtinTarget ?? null;
}

export function isValidRepoRelativeTargetPath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (path.isAbsolute(trimmed)) return false;
  const normalized = path.normalize(trimmed);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return false;
  return normalized !== '' && normalized !== '.';
}
