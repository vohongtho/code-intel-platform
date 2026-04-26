import type { RepoGroup } from './group-config.js';
import { loadGroupConfig, saveGroupConfig } from './group-config.js';
import path from 'node:path';
import fs from 'node:fs';

const GROUPS_DIR = path.join(process.env.HOME ?? '~', '.code-intel', 'groups');

export function listGroups(): RepoGroup[] {
  const groups: RepoGroup[] = [];
  try {
    const files = fs.readdirSync(GROUPS_DIR);
    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const group = loadGroupConfig(path.join(GROUPS_DIR, file));
      if (group) groups.push(group);
    }
  } catch { /* dir doesn't exist */ }
  return groups;
}

export function getGroup(name: string): RepoGroup | null {
  for (const ext of ['.yml', '.yaml']) {
    const configPath = path.join(GROUPS_DIR, name + ext);
    const group = loadGroupConfig(configPath);
    if (group) return group;
  }
  return null;
}

export function createGroup(group: RepoGroup): void {
  const configPath = path.join(GROUPS_DIR, group.name + '.yml');
  saveGroupConfig(configPath, group);
}

export function deleteGroup(name: string): void {
  for (const ext of ['.yml', '.yaml']) {
    const configPath = path.join(GROUPS_DIR, name + ext);
    try { fs.unlinkSync(configPath); } catch { /* ignore */ }
  }
}
