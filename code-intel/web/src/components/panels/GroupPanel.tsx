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

interface SelectedEdge {
  edge: TopoEdge;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return '#22c55e';
  if (c >= 0.5) return '#eab308';
  return '#ef4444';
}

function confidenceBorderClass(c: number): string {
  if (c >= 0.8) return 'border-green-500';
  if (c >= 0.5) return 'border-yellow-500';
  return 'border-red-500';
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
    return (
      <div className="p-4 text-sm text-gray-500">Loading groups…</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-400">{error}</div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-600">
        <p>No groups configured.</p>
        <p className="mt-1">Use <span className="font-mono text-gray-400">code-intel group create &lt;name&gt;</span> to create one.</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full text-sm">
      <div className="p-3 border-b border-gray-800/50">
        <h3 className="text-[10px] font-bold tracking-wider text-indigo-400/80 uppercase mb-1">
          ⬡ Groups ({groups.length})
        </h3>
      </div>

      <div className="space-y-0">
        {groups.map((g) => (
          <div key={g.name} className="border-b border-gray-800/30">
            {/* Group header */}
            <div className="px-3 py-2 flex items-center justify-between">
              <button
                className="flex items-center gap-1.5 text-left flex-1 min-w-0"
                onClick={() => setExpanded(expanded === g.name ? null : g.name)}
              >
                <span className="text-[10px] text-gray-500 shrink-0">
                  {expanded === g.name ? '▾' : '▸'}
                </span>
                <span className="text-xs font-semibold text-indigo-300 truncate">{g.name}</span>
                <span className="text-[10px] text-gray-600 shrink-0">({g.memberCount})</span>
              </button>
              <button
                onClick={() => handleViewTopology(g.name)}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 hover:border-cyan-700 rounded px-1.5 py-0.5 transition ml-2 shrink-0"
              >
                topology
              </button>
            </div>

            {/* Last sync info */}
            {g.lastSync && (
              <div className="px-3 pb-1">
                <p className="text-[9px] text-gray-600">
                  Synced: {new Date(g.lastSync).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Topology view */}
      {topoGroup && (
        <div className="border-t border-gray-800/50 mt-2">
          <div className="px-3 py-2 flex items-center justify-between">
            <h3 className="text-[10px] font-bold tracking-wider text-cyan-500/80 uppercase">
              Topology: {topoGroup}
            </h3>
            <button
              onClick={() => { setTopoGroup(null); setTopoData(null); setSelectedEdge(null); }}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          {topoLoading && (
            <div className="px-3 py-2 text-[10px] text-gray-500">Loading topology…</div>
          )}

          {topoData && !topoLoading && (
            <div className="px-3 pb-3">
              {/* Repo boxes */}
              <div className="flex flex-wrap gap-2 mb-3">
                {topoData.repos.map((repo) => {
                  // Determine border based on best confidence edge touching this repo
                  const repoEdges = topoData.edges.filter(
                    (e) => e.source === repo.name || e.target === repo.name,
                  );
                  const bestConf = repoEdges.reduce((max, e) => Math.max(max, e.confidence), 0);
                  const borderClass = repoEdges.length > 0
                    ? confidenceBorderClass(bestConf)
                    : 'border-gray-700';

                  return (
                    <div
                      key={repo.name}
                      className={`border rounded-md px-2 py-1.5 bg-gray-900/50 cursor-pointer hover:bg-gray-800/60 transition ${borderClass}`}
                      title={`${repo.groupPath}\n${repo.nodeCount} nodes · ${repo.edgeCount} edges`}
                    >
                      <div className="text-[10px] font-semibold text-white truncate max-w-[120px]">{repo.name}</div>
                      <div className="text-[9px] text-gray-500 font-mono">{repo.nodeCount}n · {repo.edgeCount}e</div>
                    </div>
                  );
                })}
              </div>

              {/* Edges */}
              {topoData.edges.length > 0 && (
                <div>
                  <h4 className="text-[9px] font-bold tracking-wider text-gray-600 uppercase mb-1">
                    Cross-repo edges ({topoData.edges.length})
                  </h4>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {topoData.edges.map((edge, i) => (
                      <button
                        key={i}
                        className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-800/50 transition"
                        onClick={() => setSelectedEdge(selectedEdge?.edge === edge ? null : { edge })}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: confidenceColor(edge.confidence) }}
                        />
                        <span className="text-[10px] text-green-400 font-mono truncate">{edge.source}</span>
                        <span className="text-[9px] text-gray-600">→</span>
                        <span className="text-[10px] text-indigo-400 font-mono truncate">{edge.target}</span>
                        <span className="text-[9px] text-gray-600 ml-auto shrink-0">
                          {(edge.confidence * 100).toFixed(0)}%
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {topoData.edges.length === 0 && (
                <p className="text-[10px] text-gray-600">No cross-repo edges. Run group sync first.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edge detail popup */}
      {selectedEdge && (
        <div className="mx-3 mb-3 bg-gray-900/80 border border-gray-700/60 rounded-md p-2">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-[9px] font-bold tracking-wider text-gray-400 uppercase">Edge Detail</h4>
            <button
              onClick={() => setSelectedEdge(null)}
              className="text-[10px] text-gray-600 hover:text-gray-400"
            >
              ✕
            </button>
          </div>
          <div className="space-y-0.5 text-[10px]">
            <div><span className="text-gray-500">Contract:</span> <span className="text-white font-mono">{selectedEdge.edge.contractName}</span></div>
            <div><span className="text-gray-500">Provider:</span> <span className="text-green-400 font-mono">{selectedEdge.edge.source}</span></div>
            <div><span className="text-gray-500">Consumer:</span> <span className="text-indigo-400 font-mono">{selectedEdge.edge.target}</span></div>
            <div>
              <span className="text-gray-500">Confidence:</span>{' '}
              <span style={{ color: confidenceColor(selectedEdge.edge.confidence) }} className="font-mono">
                {(selectedEdge.edge.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <div><span className="text-gray-500">Kind:</span> <span className="text-gray-300">{selectedEdge.edge.kind}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
