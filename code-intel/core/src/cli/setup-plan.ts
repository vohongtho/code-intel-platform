import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_OPTIONS,
  type AgentSetupIntegrationId,
} from './agent-targets.js';
import type { AgentTargetSelection } from '../storage/metadata.js';

export type SetupSelectionStatus = 'valid' | 'missing' | 'invalid' | 'all-agents';

export interface SetupPlan {
  repositoryRoot: string;
  selectionPath: string;
  selectionStatus: SetupSelectionStatus;
  selectedAgents: string[];
  unknownAgents: string[];
  integrations: AgentSetupIntegrationId[];
  reason?: string;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function validateSelection(value: unknown): AgentTargetSelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AgentTargetSelection>;
  if (!Array.isArray(candidate.selectedAgents)) return null;
  if (!candidate.targets || typeof candidate.targets !== 'object' || Array.isArray(candidate.targets)) return null;
  if (!candidate.selectedAgents.every((agentId) => typeof agentId === 'string' && agentId.trim().length > 0)) {
    return null;
  }
  return candidate as AgentTargetSelection;
}

function integrationsForAgents(agentIds: string[]): {
  integrations: AgentSetupIntegrationId[];
  unknownAgents: string[];
} {
  const optionsById = new Map(AGENT_OPTIONS.map((option) => [option.id, option]));
  const unknownAgents: string[] = [];
  const integrations: AgentSetupIntegrationId[] = [];
  for (const agentId of agentIds) {
    const option = optionsById.get(agentId);
    if (!option) {
      unknownAgents.push(agentId);
      continue;
    }
    integrations.push(...(option.setupIntegrations ?? []));
  }
  return {
    integrations: unique(integrations),
    unknownAgents: unique(unknownAgents),
  };
}

export function resolveSetupPlan(
  repositoryPath: string,
  options: { allAgents?: boolean } = {},
): SetupPlan {
  const repositoryRoot = path.resolve(repositoryPath);
  const selectionPath = path.join(repositoryRoot, '.code-intel', 'agent-targets.json');

  if (!fs.existsSync(repositoryRoot) || !fs.statSync(repositoryRoot).isDirectory()) {
    return {
      repositoryRoot,
      selectionPath,
      selectionStatus: 'invalid',
      selectedAgents: [],
      unknownAgents: [],
      integrations: [],
      reason: 'Repository path does not exist or is not a directory',
    };
  }

  if (options.allAgents) {
    const selectedAgents = AGENT_OPTIONS
      .filter((option) => (option.setupIntegrations?.length ?? 0) > 0)
      .map((option) => option.id);
    const resolved = integrationsForAgents(selectedAgents);
    return {
      repositoryRoot,
      selectionPath,
      selectionStatus: 'all-agents',
      selectedAgents,
      unknownAgents: [],
      integrations: resolved.integrations,
    };
  }

  if (!fs.existsSync(selectionPath)) {
    return {
      repositoryRoot,
      selectionPath,
      selectionStatus: 'missing',
      selectedAgents: [],
      unknownAgents: [],
      integrations: [],
      reason: 'No saved repository agent selection',
    };
  }

  try {
    const parsed = validateSelection(JSON.parse(fs.readFileSync(selectionPath, 'utf8')) as unknown);
    if (!parsed) {
      return {
        repositoryRoot,
        selectionPath,
        selectionStatus: 'invalid',
        selectedAgents: [],
        unknownAgents: [],
        integrations: [],
        reason: 'agent-targets.json does not match the expected schema',
      };
    }
    const selectedAgents = unique(parsed.selectedAgents);
    const resolved = integrationsForAgents(selectedAgents);
    return {
      repositoryRoot,
      selectionPath,
      selectionStatus: 'valid',
      selectedAgents,
      unknownAgents: resolved.unknownAgents,
      integrations: resolved.integrations,
    };
  } catch (error) {
    return {
      repositoryRoot,
      selectionPath,
      selectionStatus: 'invalid',
      selectedAgents: [],
      unknownAgents: [],
      integrations: [],
      reason: `Could not parse agent-targets.json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
