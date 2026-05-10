import React, { useState, useEffect, useCallback } from 'react';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';

interface GroupMember {
  groupPath: string;
  registryName: string;
}

interface GroupInfo {
  name: string;
  memberCount: number;
  lastSync: string | null;
  createdAt: string;
}

interface GroupDetail {
  name: string;
  members: GroupMember[];
  lastSync?: string;
  createdAt: string;
}

interface RepoEntry {
  name: string;
  path: string;
  nodes: number;
  edges: number;
  indexedAt: string | null;
}

interface TopoRepo {
  name: string;
  groupPath: string;
  nodeCount: number;
  edgeCount: number;
}

interface TopoEdge {
  source: string;
  target: string;
  contractName: string;
  confidence: number;
  kind: string;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return '#4ade80';
  if (c >= 0.5) return '#fbbf24';
  return '#f87171';
}

function confidenceBorderClass(c: number): string {
  if (c >= 0.8) return 'border-node-class/60';
  if (c >= 0.5) return 'border-amber-500/60';
  return 'border-red-500/60';
}

// ── Sub-component: Create Group modal ─────────────────────────────────────────
function CreateGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const { state } = useAppState();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const client = new ApiClient(state.serverUrl);
      await client.createGroup(name.trim());
      onCreated(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-border-subtle rounded-xl shadow-2xl w-80 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">Create Group</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary text-xs">✕</button>
        </div>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onClose(); }}
          placeholder="Group name…"
          className="w-full bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
        />
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary rounded-lg border border-border-subtle hover:bg-hover transition">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-component: Edit Group panel ───────────────────────────────────────────
function EditGroupPanel({
  group,
  repos,
  onClose,
  onSaved,
  onDeleted,
}: {
  group: GroupDetail;
  repos: RepoEntry[];
  onClose: () => void;
  onSaved: (g: GroupDetail) => void;
  onDeleted: (name: string) => void;
}) {
  const { state } = useAppState();
  const [editName, setEditName] = useState(group.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addPath, setAddPath] = useState('');
  const [addRepo, setAddRepo] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);

  const client = new ApiClient(state.serverUrl);

  const handleRename = async () => {
    if (!editName.trim() || editName.trim() === group.name) return;
    setRenaming(true);
    setRenameError('');
    try {
      await client.renameGroup(group.name, editName.trim());
      onSaved({ ...group, name: editName.trim() });
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.deleteGroup(group.name);
      onDeleted(group.name);
    } catch (err) {
      setDeleting(false);
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleAddMember = async () => {
    if (!addPath.trim() || !addRepo) return;
    setAdding(true);
    setAddError('');
    try {
      const updated = await client.addGroupMember(group.name, addPath.trim(), addRepo);
      onSaved({ ...group, members: updated.members });
      setAddPath('');
      setAddRepo('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (gPath: string) => {
    setRemovingPath(gPath);
    try {
      const updated = await client.removeGroupMember(group.name, gPath);
      onSaved({ ...group, members: updated.members });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemovingPath(null);
    }
  };

  // Repos not already in the group, sorted alphabetically
  const availableRepos = repos
    .filter((r) => !group.members.some((m) => m.registryName === r.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="border-t border-border-subtle bg-deep/60">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle/50">
        <span className="text-[10px] font-bold tracking-wider text-accent/80 uppercase truncate">Edit: {group.name}</span>
        <button onClick={onClose} className="text-[10px] text-text-muted hover:text-text-secondary shrink-0 ml-2">✕</button>
      </div>

      <div className="px-3 py-2 space-y-3">
        {/* Rename */}
        <div>
          <label className="text-[9px] font-bold tracking-wider text-text-muted uppercase block mb-1">Name</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
              className="flex-1 min-w-0 bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleRename}
              disabled={renaming || !editName.trim() || editName.trim() === group.name}
              className="px-2 py-1 text-[10px] bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 disabled:opacity-40 transition shrink-0"
            >
              {renaming ? '…' : 'Rename'}
            </button>
          </div>
          {renameError && <p className="text-[9px] text-red-400 mt-1">{renameError}</p>}
        </div>

        {/* Members list */}
        <div>
          <label className="text-[9px] font-bold tracking-wider text-text-muted uppercase block mb-1">
            Members ({group.members.length})
          </label>
          {group.members.length === 0 && (
            <p className="text-[10px] text-text-muted/50 italic">No members yet.</p>
          )}
          <div className="space-y-0.5 max-h-28 overflow-y-auto scrollbar-thin">
            {group.members.map((m) => (
              <div key={m.groupPath} className="flex items-center gap-1.5 py-0.5 pr-0.5">
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] text-text-primary font-semibold truncate block">{m.registryName}</span>
                  <span className="text-[9px] text-text-muted/50 font-mono truncate block">{m.groupPath}</span>
                </div>
                <button
                  onClick={() => handleRemoveMember(m.groupPath)}
                  disabled={removingPath === m.groupPath}
                  className="shrink-0 text-[9px] text-red-400/60 hover:text-red-400 border border-red-500/20 hover:border-red-500/50 rounded px-1 py-0.5 transition disabled:opacity-40"
                  title="Remove member"
                >
                  {removingPath === m.groupPath ? '…' : '✕'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Add member */}
        <div>
          <label className="text-[9px] font-bold tracking-wider text-text-muted uppercase block mb-1">Add Repo</label>
          {availableRepos.length === 0 ? (
            <p className="text-[9px] text-text-muted/50 italic">All indexed repos are already members.</p>
          ) : (
            <div className="space-y-1.5">
              <select
                value={addRepo}
                onChange={(e) => setAddRepo(e.target.value)}
                className="w-full bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">Select repo… ({availableRepos.length})</option>
                {availableRepos.map((r) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={addPath}
                  onChange={(e) => setAddPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddMember(); }}
                  placeholder="Path in group (e.g. services/api)"
                  className="flex-1 min-w-0 bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted/50 focus:border-accent focus:outline-none"
                />
                <button
                  onClick={handleAddMember}
                  disabled={adding || !addPath.trim() || !addRepo}
                  className="px-2 py-1 text-[10px] bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 disabled:opacity-40 transition shrink-0"
                >
                  {adding ? '…' : 'Add'}
                </button>
              </div>
            </div>
          )}
          {addError && <p className="text-[9px] text-red-400 mt-1">{addError}</p>}
        </div>

        {/* Delete */}
        <div className="pt-1 border-t border-border-subtle/30">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/50 rounded px-2 py-1 transition w-full"
            >
              Delete group
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-red-400 flex-1 truncate">Delete "{group.name}"?</span>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-text-muted hover:text-text-secondary border border-border-subtle rounded px-2 py-0.5 transition shrink-0"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-[10px] text-white bg-red-600 hover:bg-red-500 rounded px-2 py-0.5 transition disabled:opacity-50 shrink-0"
              >
                {deleting ? '…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main GroupPanel ───────────────────────────────────────────────────────────
export function GroupPanel() {
  const { state } = useAppState();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<GroupDetail | null>(null);
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [topoData, setTopoData] = useState<{ repos: TopoRepo[]; edges: TopoEdge[] } | null>(null);
  const [topoLoading, setTopoLoading] = useState(false);
  const [topoGroup, setTopoGroup] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<TopoEdge | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const client = new ApiClient(state.serverUrl);

  const loadGroups = useCallback(() => {
    setLoading(true);
    setError('');
    client.listGroups()
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load groups'))
      .finally(() => setLoading(false));
  }, [state.serverUrl]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  useEffect(() => {
    client.listRepos().then(setRepos).catch(() => {});
  }, [state.serverUrl]);

  const handleEdit = async (groupName: string) => {
    try {
      const detail = await client.getGroup(groupName);
      setEditingGroup(detail);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load group');
    }
  };

  const handleViewTopology = async (groupName: string) => {
    setTopoLoading(true);
    setTopoGroup(groupName);
    setTopoData(null);
    setSelectedEdge(null);
    try {
      const data = await client.getGroupTopology(groupName);
      setTopoData(data);
    } catch {
      setTopoData({ repos: [], edges: [] });
    } finally {
      setTopoLoading(false);
    }
  };

  const handleSync = async (groupName: string) => {
    setSyncing(groupName);
    try {
      await client.syncGroup(groupName);
      loadGroups();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(null);
    }
  };

  const handleGroupCreated = (name: string) => {
    setShowCreate(false);
    loadGroups();
    handleEdit(name);
  };

  const handleGroupSaved = (updated: GroupDetail) => {
    setEditingGroup(updated);
    loadGroups();
  };

  const handleGroupDeleted = (name: string) => {
    setEditingGroup(null);
    setGroups((prev) => prev.filter((g) => g.name !== name));
  };

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="p-4 text-sm text-text-muted animate-pulse">Loading groups…</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-red-400">{error}</div>;
  }

  return (
    <div className="flex flex-col h-full text-sm overflow-hidden">
      {/* Header + Create button */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between shrink-0">
        <h3 className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
          ⬡ Groups ({groups.length})
        </h3>
        <button
          onClick={() => setShowCreate(true)}
          className="text-[10px] text-accent hover:text-accent/80 border border-accent/30 hover:border-accent/60 rounded px-1.5 py-0.5 transition flex items-center gap-1"
          title="Create new group"
        >
          + New
        </button>
      </div>

      {/* Search bar — shown when there are groups */}
      {groups.length > 0 && (
        <div className="px-2 py-1.5 border-b border-border-subtle/50 shrink-0">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-[10px] pointer-events-none">⌕</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter groups…"
              className="w-full bg-elevated border border-border-subtle rounded pl-6 pr-2 py-1 text-[10px] text-text-primary placeholder-text-muted/60 focus:border-accent focus:outline-none transition"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted/50 hover:text-text-muted text-[10px]"
              >✕</button>
            )}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreated={handleGroupCreated}
        />
      )}

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {groups.length === 0 ? (
          <div className="p-4 text-xs text-text-muted">
            <p>No groups yet.</p>
            <p className="mt-1">Click <strong>+ New</strong> to create one, or run:</p>
            <code className="font-mono text-text-secondary text-[10px]">code-intel group create &lt;name&gt;</code>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="p-4 text-xs text-text-muted text-center">No groups match "{search}"</div>
        ) : (
          <div className="space-y-0">
            {filteredGroups.map((g) => (
              <div key={g.name} className="border-b border-border-subtle/50">
                <div className="px-3 py-2 flex items-center gap-1.5">
                  {/* Expand toggle */}
                  <button
                    className="flex items-center gap-1 text-left flex-1 min-w-0"
                    onClick={() => setExpanded(expanded === g.name ? null : g.name)}
                  >
                    <span className="text-[10px] text-text-muted shrink-0">{expanded === g.name ? '▾' : '▸'}</span>
                    <span className="text-xs font-semibold text-accent truncate">{g.name}</span>
                    <span className="text-[10px] text-text-muted shrink-0">({g.memberCount})</span>
                  </button>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleViewTopology(g.name)}
                      className="text-[9px] text-text-muted hover:text-accent border border-border-subtle hover:border-accent/40 rounded px-1 py-0.5 transition"
                      title="View topology"
                    >
                      ⬡
                    </button>
                    <button
                      onClick={() => handleSync(g.name)}
                      disabled={syncing === g.name}
                      className="text-[9px] text-text-muted hover:text-accent border border-border-subtle hover:border-accent/40 rounded px-1 py-0.5 transition disabled:opacity-40"
                      title="Sync group"
                    >
                      {syncing === g.name ? '⟳' : '↻'}
                    </button>
                    <button
                      onClick={() => editingGroup?.name === g.name ? setEditingGroup(null) : handleEdit(g.name)}
                      className={`text-[9px] border rounded px-1 py-0.5 transition ${
                        editingGroup?.name === g.name
                          ? 'text-accent border-accent/60 bg-accent/10'
                          : 'text-text-muted hover:text-accent border-border-subtle hover:border-accent/40'
                      }`}
                      title="Edit group"
                    >
                      ✎
                    </button>
                  </div>
                </div>

                {/* Last sync */}
                {expanded === g.name && g.lastSync && (
                  <div className="px-6 pb-1.5">
                    <p className="text-[9px] text-text-muted/50">
                      Last synced: {new Date(g.lastSync).toLocaleString()}
                    </p>
                  </div>
                )}

                {/* Edit panel (inline, below the row) */}
                {editingGroup?.name === g.name && (
                  <EditGroupPanel
                    group={editingGroup}
                    repos={repos}
                    onClose={() => setEditingGroup(null)}
                    onSaved={handleGroupSaved}
                    onDeleted={handleGroupDeleted}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Topology view */}
        {topoGroup && (
          <div className="border-t border-border-subtle mt-2">
            <div className="px-3 py-2 flex items-center justify-between">
              <h3 className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
                Topology: {topoGroup}
              </h3>
              <button
                onClick={() => { setTopoGroup(null); setTopoData(null); setSelectedEdge(null); }}
                className="text-[10px] text-text-muted hover:text-text-secondary"
              >
                ✕
              </button>
            </div>

            {topoLoading && <div className="px-3 py-2 text-[10px] text-text-muted animate-pulse">Loading topology…</div>}

            {topoData && !topoLoading && (
              <div className="px-3 pb-3">
                <div className="flex flex-wrap gap-2 mb-3">
                  {topoData.repos.map((repo) => {
                    const repoEdges = topoData.edges.filter((e) => e.source === repo.name || e.target === repo.name);
                    const bestConf = repoEdges.reduce((max, e) => Math.max(max, e.confidence), 0);
                    const borderClass = repoEdges.length > 0 ? confidenceBorderClass(bestConf) : 'border-border-default';
                    return (
                      <div
                        key={repo.name}
                        className={`border rounded-md px-2 py-1.5 bg-surface hover:bg-hover transition ${borderClass}`}
                        title={`${repo.groupPath}\n${repo.nodeCount} nodes · ${repo.edgeCount} edges`}
                      >
                        <div className="text-[10px] font-semibold text-text-primary truncate max-w-[120px]">{repo.name}</div>
                        <div className="text-[9px] text-text-muted font-mono">{repo.nodeCount}n · {repo.edgeCount}e</div>
                      </div>
                    );
                  })}
                </div>

                {topoData.edges.length > 0 && (
                  <div>
                    <h4 className="text-[9px] font-bold tracking-wider text-text-muted uppercase mb-1">
                      Cross-repo edges ({topoData.edges.length})
                    </h4>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-thin">
                      {topoData.edges.map((edge, i) => (
                        <button
                          key={i}
                          className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded hover:bg-hover transition"
                          onClick={() => setSelectedEdge(selectedEdge === edge ? null : edge)}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: confidenceColor(edge.confidence) }} />
                          <span className="text-[10px] text-node-function font-mono truncate">{edge.source}</span>
                          <span className="text-[9px] text-text-muted">→</span>
                          <span className="text-[10px] text-accent font-mono truncate">{edge.target}</span>
                          <span className="text-[9px] text-text-muted ml-auto shrink-0">
                            {(edge.confidence * 100).toFixed(0)}%
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {topoData.edges.length === 0 && (
                  <p className="text-[10px] text-text-muted/60">No cross-repo edges. Run sync (↻) first.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Edge detail */}
        {selectedEdge && (
          <div className="mx-3 mb-3 bg-surface border border-border-subtle rounded-md p-2">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-[9px] font-bold tracking-wider text-text-muted uppercase">Edge Detail</h4>
              <button onClick={() => setSelectedEdge(null)} className="text-[10px] text-text-muted hover:text-text-secondary">✕</button>
            </div>
            <div className="space-y-0.5 text-[10px]">
              <div><span className="text-text-muted">Contract:</span> <span className="text-text-primary font-mono">{selectedEdge.contractName}</span></div>
              <div><span className="text-text-muted">Provider:</span> <span className="text-node-function font-mono">{selectedEdge.source}</span></div>
              <div><span className="text-text-muted">Consumer:</span> <span className="text-accent font-mono">{selectedEdge.target}</span></div>
              <div>
                <span className="text-text-muted">Confidence:</span>{' '}
                <span style={{ color: confidenceColor(selectedEdge.confidence) }} className="font-mono">
                  {(selectedEdge.confidence * 100).toFixed(1)}%
                </span>
              </div>
              <div><span className="text-text-muted">Kind:</span> <span className="text-text-secondary">{selectedEdge.kind}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
