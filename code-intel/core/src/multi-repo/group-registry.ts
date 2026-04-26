/**
 * Persistent store for repo groups.
 * Each group is saved as ~/.code-intel/groups/<name>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RepoGroup, GroupMember } from './types.js';

const GROUPS_DIR = path.join(os.homedir(), '.code-intel', 'groups');

function groupFile(name: string): string {
  return path.join(GROUPS_DIR, `${name}.json`);
}

export function loadGroup(name: string): RepoGroup | null {
  try {
    return JSON.parse(fs.readFileSync(groupFile(name), 'utf-8')) as RepoGroup;
  } catch {
    return null;
  }
}

export function saveGroup(group: RepoGroup): void {
  fs.mkdirSync(GROUPS_DIR, { recursive: true });
  fs.writeFileSync(groupFile(group.name), JSON.stringify(group, null, 2) + '\n');
}

export function listGroups(): RepoGroup[] {
  const groups: RepoGroup[] = [];
  try {
    for (const file of fs.readdirSync(GROUPS_DIR)) {
      if (!file.endsWith('.json') || file.endsWith('.sync.json')) continue;
      try {
        const g = JSON.parse(
          fs.readFileSync(path.join(GROUPS_DIR, file), 'utf-8'),
        ) as RepoGroup;
        groups.push(g);
      } catch { /* skip malformed */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return groups;
}

export function deleteGroup(name: string): void {
  try { fs.unlinkSync(groupFile(name)); } catch { /* ignore */ }
  // also remove sync artifact
  try { fs.unlinkSync(path.join(GROUPS_DIR, `${name}.sync.json`)); } catch { /* ignore */ }
}

export function groupExists(name: string): boolean {
  return fs.existsSync(groupFile(name));
}

/** Add or update a member (by groupPath). Returns the updated group. */
export function addMember(groupName: string, member: GroupMember): RepoGroup {
  const group = loadGroup(groupName);
  if (!group) throw new Error(`Group "${groupName}" not found.`);
  // replace if same groupPath already exists
  const idx = group.members.findIndex((m) => m.groupPath === member.groupPath);
  if (idx >= 0) {
    group.members[idx] = member;
  } else {
    group.members.push(member);
  }
  saveGroup(group);
  return group;
}

/** Remove a member by groupPath. Returns the updated group. */
export function removeMember(groupName: string, groupPath: string): RepoGroup {
  const group = loadGroup(groupName);
  if (!group) throw new Error(`Group "${groupName}" not found.`);
  const before = group.members.length;
  group.members = group.members.filter((m) => m.groupPath !== groupPath);
  if (group.members.length === before) {
    throw new Error(`No member at path "${groupPath}" in group "${groupName}".`);
  }
  saveGroup(group);
  return group;
}

// ─── Sync result persistence ──────────────────────────────────────────────────

import type { GroupSyncResult } from './types.js';

export function saveSyncResult(result: GroupSyncResult): void {
  fs.mkdirSync(GROUPS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(GROUPS_DIR, `${result.groupName}.sync.json`),
    JSON.stringify(result, null, 2) + '\n',
  );
}

export function loadSyncResult(groupName: string): GroupSyncResult | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(GROUPS_DIR, `${groupName}.sync.json`), 'utf-8'),
    ) as GroupSyncResult;
  } catch {
    return null;
  }
}
