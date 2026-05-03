import React, { useState, useEffect } from 'react';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';

interface GroupInfo {
  name: string;
  memberCount: number;
  lastSync: string | null;
  createdAt: string;
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

interface SelectedEdge { edge: TopoEdge }

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

export function GroupPanel() {
  const { state } = useAppState();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [topoData, setTopoData] = useState<{ repos: TopoRepo[]; edges: TopoEdge[] } | null>(null);
  const [topoLoading, setTopoLoading] = useState(false);
  const [topoGroup, setTopoGroup] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);

  useEffect(() => {
    const client = new ApiClient(state.serverUrl);
    setLoading(true);
    setError('');
    client.listGroups()
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load groups'))
      .finally(() => setLoading(false));
  }, [state.serverUrl]);

  const handleViewTopology = async (groupName: string) => {
    const client = new ApiClient(state.serverUrl);
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

  if (loading) {
    return <div className="p-4 text-sm text-text-muted">Loading groups…</div>;
  }

  if (error) {
    return <div className="p-4 text-sm text-red-400">{error}</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-text-muted">
        <p>No groups configured.</p>
        <p className="mt-1">Use <span className="font-mono text-text-secondary">code-intel group create &lt;name&gt;</span> to create one.</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto scrollbar-thin h-full text-sm">
      <div className="p-3 border-b border-border-subtle">
        <h3 className="text-[10px] font-bold tracking-wider text-accent/80 uppercase mb-1">
          ⬡ Groups ({groups.length})
        </h3>
      </div>

      <div className="space-y-0">
        {groups.map((g) => (
          <div key={g.name} className="border-b border-border-subtle/50">
            <div className="px-3 py-2 flex items-center justify-between">
              <button
                className="flex items-center gap-1.5 text-left flex-1 min-w-0"
                onClick={() => setExpanded(expanded === g.name ? null : g.name)}
              >
                <span className="text-[10px] text-text-muted shrink-0">{expanded === g.name ? '▾' : '▸'}</span>
                <span className="text-xs font-semibold text-accent truncate">{g.name}</span>
                <span className="text-[10px] text-text-muted shrink-0">({g.memberCount})</span>
              </button>
              <button
                onClick={() => handleViewTopology(g.name)}
                className="text-[10px] text-accent hover:text-accent/80 border border-accent/30 hover:border-accent/60 rounded px-1.5 py-0.5 transition ml-2 shrink-0"
              >
                topology
              </button>
            </div>
            {g.lastSync && (
              <div className="px-3 pb-1">
                <p className="text-[9px] text-text-muted/50">
                  Synced: {new Date(g.lastSync).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

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

          {topoLoading && <div className="px-3 py-2 text-[10px] text-text-muted">Loading topology…</div>}

          {topoData && !topoLoading && (
            <div className="px-3 pb-3">
              {/* Repo boxes */}
              <div className="flex flex-wrap gap-2 mb-3">
                {topoData.repos.map((repo) => {
                  const repoEdges = topoData.edges.filter((e) => e.source === repo.name || e.target === repo.name);
                  const bestConf = repoEdges.reduce((max, e) => Math.max(max, e.confidence), 0);
                  const borderClass = repoEdges.length > 0 ? confidenceBorderClass(bestConf) : 'border-border-default';
                  return (
                    <div
                      key={repo.name}
                      className={`border rounded-md px-2 py-1.5 bg-surface cursor-pointer hover:bg-hover transition ${borderClass}`}
                      title={`${repo.groupPath}\n${repo.nodeCount} nodes · ${repo.edgeCount} edges`}
                    >
                      <div className="text-[10px] font-semibold text-text-primary truncate max-w-[120px]">{repo.name}</div>
                      <div className="text-[9px] text-text-muted font-mono">{repo.nodeCount}n · {repo.edgeCount}e</div>
                    </div>
                  );
                })}
              </div>

              {/* Edges */}
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
                        onClick={() => setSelectedEdge(selectedEdge?.edge === edge ? null : { edge })}
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
                <p className="text-[10px] text-text-muted/60">No cross-repo edges. Run group sync first.</p>
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
            <div><span className="text-text-muted">Contract:</span> <span className="text-text-primary font-mono">{selectedEdge.edge.contractName}</span></div>
            <div><span className="text-text-muted">Provider:</span> <span className="text-node-function font-mono">{selectedEdge.edge.source}</span></div>
            <div><span className="text-text-muted">Consumer:</span> <span className="text-accent font-mono">{selectedEdge.edge.target}</span></div>
            <div>
              <span className="text-text-muted">Confidence:</span>{' '}
              <span style={{ color: confidenceColor(selectedEdge.edge.confidence) }} className="font-mono">
                {(selectedEdge.edge.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <div><span className="text-text-muted">Kind:</span> <span className="text-text-secondary">{selectedEdge.edge.kind}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
