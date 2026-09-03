/**
 * Persistent store for repo groups.
 * Each group is saved as ~/.code-intel/groups/<name>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { RepoGroup, GroupMember, GroupSyncResult, Contract, ContractLink } from './types.js';
import type { AnalysisCoverage } from '../shared/index.js';
import { GROUP_CONTRACT_SCHEMA_VERSION } from './contract-fingerprint.js';
import { findRepoById, findRepoByName, loadRegistry } from '../storage/repo-registry.js';

const GROUPS_DIR = path.join(os.homedir(), '.code-intel', 'groups');
const GROUP_STATE_SCHEMA_VERSION = GROUP_CONTRACT_SCHEMA_VERSION;

function groupFile(name: string): string {
  return path.join(GROUPS_DIR, `${name}.json`);
}

function backupPath(filePath: string): string {
  return `${filePath}.unreadable`;
}

function normalizeGroup(group: RepoGroup): RepoGroup {
  return {
    ...group,
    schemaVersion: group.schemaVersion ?? GROUP_STATE_SCHEMA_VERSION,
  };
}

function migrateGroup(group: RepoGroup): RepoGroup {
  const registry = loadRegistry();
  let changed = false;
  const members = group.members.map((member) => {
    if (member.repoId) {
      const repo = findRepoById(member.repoId, registry);
      if (repo && member.registryName !== repo.name) {
        changed = true;
        return { ...member, registryName: repo.name };
      }
      return member;
    }
    const repo = findRepoByName(member.registryName, registry);
    if (!repo) return member;
    changed = true;
    return { ...member, repoId: repo.id, registryName: repo.name };
  });
  const next = normalizeGroup({ ...group, members });
  return changed || !group.schemaVersion ? next : group;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function isGroupShape(value: RepoGroup | null): value is RepoGroup {
  return Boolean(
    value
    && typeof value.name === 'string'
    && typeof value.createdAt === 'string'
    && Array.isArray(value.members),
  );
}

function isSyncResultShape(value: GroupSyncResult | null): value is GroupSyncResult {
  return Boolean(
    value
    && typeof value.groupName === 'string'
    && typeof value.syncedAt === 'string'
    && typeof value.memberCount === 'number'
    && Array.isArray(value.contracts)
    && Array.isArray(value.links),
  );
}

function quarantineUnreadable(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const next = backupPath(filePath);
    if (!fs.existsSync(next)) fs.copyFileSync(filePath, next);
  } catch {
    // ponytail: best-effort quarantine only; add structured corruption reporting when caller surfaces diagnostics.
  }
}

export function loadGroup(name: string): RepoGroup | null {
  const filePath = groupFile(name);
  const raw = readJsonFile<RepoGroup>(filePath);
  if (!isGroupShape(raw)) {
    quarantineUnreadable(filePath);
    return null;
  }
  const group = migrateGroup(raw);
  if (JSON.stringify(group) !== JSON.stringify(raw)) saveGroup(group);
  return group;
}

export function saveGroup(group: RepoGroup): void {
  fs.mkdirSync(GROUPS_DIR, { recursive: true });
  fs.writeFileSync(groupFile(group.name), JSON.stringify(normalizeGroup(group), null, 2) + '\n');
}

export function listGroups(): RepoGroup[] {
  const groups: RepoGroup[] = [];
  try {
    for (const file of fs.readdirSync(GROUPS_DIR)) {
      if (!file.endsWith('.json') || file.endsWith('.sync.json')) continue;
      const g = readJsonFile<RepoGroup>(path.join(GROUPS_DIR, file));
      if (!g) continue;
      groups.push(normalizeGroup(g));
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
  const repo = member.repoId ? findRepoById(member.repoId) : findRepoByName(member.registryName);
  if (!repo) throw new Error(`Repository "${member.registryName}" not found.`);
  const normalized: GroupMember = { ...member, repoId: repo.id, registryName: repo.name };
  // replace if same groupPath already exists
  const idx = group.members.findIndex((m) => m.groupPath === member.groupPath);
  if (idx >= 0) {
    group.members[idx] = normalized;
  } else {
    group.members.push(normalized);
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

function legacyCoverage(reason: string): AnalysisCoverage {
  return { complete: false, examinedCount: 0, incompleteReasons: [reason] };
}

function normalizeContract(contract: Contract): Contract {
  return {
    ...contract,
    role: contract.role ?? 'unknown',
    certainty: contract.certainty ?? 'legacy',
    coverage: contract.coverage ?? legacyCoverage('legacy group contract state'),
  };
}

function normalizeLink(link: ContractLink): ContractLink {
  return {
    ...link,
    certainty: link.certainty ?? 'legacy',
    coverage: link.coverage ?? legacyCoverage('legacy group link state'),
  };
}

function normalizeSyncResult(result: GroupSyncResult): GroupSyncResult {
  const contracts = Array.isArray(result.contracts) ? result.contracts.map(normalizeContract) : [];
  const links = Array.isArray(result.links) ? result.links.map(normalizeLink) : [];
  return {
    ...result,
    schemaVersion: result.schemaVersion ?? GROUP_CONTRACT_SCHEMA_VERSION,
    contracts,
    links,
    contractVersions: result.contractVersions,
    changedContractIds: result.changedContractIds,
    consumerIndex: result.consumerIndex,
    driftSummary: result.driftSummary,
  };
}

function syncResultFile(groupName: string): string {
  return path.join(GROUPS_DIR, `${groupName}.sync.json`);
}

export function saveSyncResult(result: GroupSyncResult): void {
  fs.mkdirSync(GROUPS_DIR, { recursive: true });
  fs.writeFileSync(
    syncResultFile(result.groupName),
    JSON.stringify(normalizeSyncResult(result), null, 2) + '\n',
  );
}

export function loadSyncResult(groupName: string): GroupSyncResult | null {
  const filePath = syncResultFile(groupName);
  const raw = readJsonFile<GroupSyncResult>(filePath);
  if (!isSyncResultShape(raw)) {
    quarantineUnreadable(filePath);
    return null;
  }
  const normalized = normalizeSyncResult(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) saveSyncResult(normalized);
  return normalized;
}

export function verifySyncResultReadBack(result: GroupSyncResult): { ok: true } | { ok: false; reason: string } {
  const reloaded = loadSyncResult(result.groupName);
  if (!reloaded) return { ok: false, reason: 'persisted sync result could not be reloaded' };

  const expectedContracts = [...result.contracts]
    .map((contract) => `${contract.contractId ?? ''}\u0000${contract.semanticFingerprint ?? ''}\u0000${contract.sourceCanonicalId ?? ''}`)
    .sort();
  const actualContracts = [...reloaded.contracts]
    .map((contract) => `${contract.contractId ?? ''}\u0000${contract.semanticFingerprint ?? ''}\u0000${contract.sourceCanonicalId ?? ''}`)
    .sort();
  if (JSON.stringify(expectedContracts) !== JSON.stringify(actualContracts)) {
    return { ok: false, reason: 'contract IDs/fingerprints/source IDs changed after reload' };
  }

  const expectedLinks = [...result.links]
    .map((link) => `${link.providerContractId ?? ''}\u0000${link.consumerContractId ?? ''}\u0000${link.consumerSourceCanonicalId ?? ''}`)
    .sort();
  const actualLinks = [...reloaded.links]
    .map((link) => `${link.providerContractId ?? ''}\u0000${link.consumerContractId ?? ''}\u0000${link.consumerSourceCanonicalId ?? ''}`)
    .sort();
  if (JSON.stringify(expectedLinks) !== JSON.stringify(actualLinks)) {
    return { ok: false, reason: 'consumer references changed after reload' };
  }

  return { ok: true };
}
