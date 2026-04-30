import React, { useState, useEffect } from 'react';
import { useAppState } from '../state/app-context';
import { ApiClient } from '../api/client';
import { GraphView } from '../components/graph/GraphView';
import { NodeDetail } from '../components/panels/NodeDetail';
import { SourcePanel } from '../components/panels/SourcePanel';
import { SidebarChat } from '../components/panels/SidebarChat';
import { SidebarFiles } from '../components/panels/SidebarFiles';
import { SidebarFilters } from '../components/panels/SidebarFilters';
import { QueryPanel } from '../components/panels/QueryPanel';
import { StatusFooter } from '../components/shared/StatusFooter';
import { Header } from '../components/shared/Header';
import { KeyboardShortcutsModal } from '../components/shared/KeyboardShortcutsModal';
import { NODE_COLORS } from '../graph/colors';

type SidebarTab = 'explorer' | 'filters' | 'files' | 'query' | 'group';

export function ExplorerPage() {
  const { state, dispatch } = useAppState();
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const [aiOpen, setAiOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);

  // Toggle shortcuts modal on `?` keypress (not inside an input/textarea)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (e.key === '?' && !inInput) {
        setShortcutsOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Open SourcePanel when a node with filePath + startLine is selected
  useEffect(() => {
    if (state.selectedNode && state.selectedNode.filePath && state.selectedNode.startLine) {
      setSourcePanelOpen(true);
    } else {
      setSourcePanelOpen(false);
    }
  }, [state.selectedNode?.id]);

  const handleCloseSource = () => {
    setSourcePanelOpen(false);
  };

  return (
    <div className="flex flex-col h-screen bg-[#040812] text-white">
      <Header onToggleAI={() => setAiOpen((v) => !v)} aiOpen={aiOpen} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-72 bg-[#080b14] border-r border-gray-800/50 flex flex-col">
          <div className="flex border-b border-gray-800/50">
            {(['explorer', 'filters', 'files', 'query'] as SidebarTab[])
              .concat(state.mode === 'group' ? ['group' as SidebarTab] : [])
              .map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-3 py-2.5 text-xs font-semibold capitalize tracking-wide transition ${
                    activeTab === tab
                      ? 'text-cyan-400 border-b-2 border-cyan-500 bg-cyan-500/5'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
                  }`}
                >
                  {tab === 'group' ? '⬢ group' : tab}
                </button>
              ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTab === 'explorer' && <ExplorerTab />}
            {activeTab === 'filters' && <SidebarFilters />}
            {activeTab === 'files' && <SidebarFiles />}
            {activeTab === 'query' && <QueryPanel />}
            {activeTab === 'group' && state.mode === 'group' && <GroupTab />}
          </div>
        </div>

        {/* Center: Graph + NodeDetail + SourcePanel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative">
            <GraphView />
          </div>
          {state.selectedNode && (
            <NodeDetail
              node={state.selectedNode}
              onClose={() => dispatch({ type: 'SELECT_NODE', node: null })}
            />
          )}
          {sourcePanelOpen && state.selectedNode?.filePath && state.selectedNode?.startLine && (
            <SourcePanel
              file={state.selectedNode.filePath}
              startLine={state.selectedNode.startLine}
              endLine={state.selectedNode.endLine ?? state.selectedNode.startLine}
              onClose={handleCloseSource}
            />
          )}
        </div>

        {/* Right Sidebar: AI Chat (collapsible) */}
        {aiOpen && (
          <div className="w-96 border-l border-gray-800/50 flex flex-col">
            <SidebarChat />
          </div>
        )}
      </div>

      <StatusFooter />
    </div>
  );
}

function ExplorerTab() {
  const { state, dispatch } = useAppState();

  // Quick stats
  const kindCounts = new Map<string, number>();
  for (const n of state.nodes) kindCounts.set(n.kind, (kindCounts.get(n.kind) ?? 0) + 1);
  const sortedKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCount = sortedKinds[0]?.[1] ?? 1;

  return (
    <div className="overflow-y-auto h-full text-sm">
      {/* Search Results */}
      {state.search.results.length > 0 && (
        <div className="p-3 border-b border-gray-800/50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold tracking-wider text-cyan-500/80 uppercase">
              Search Results
            </h3>
            <span className="text-[10px] bg-cyan-900/30 text-cyan-400 px-1.5 py-0.5 rounded-full font-mono">
              {state.search.results.length}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mb-2 truncate">"{state.search.query}"</p>
          <div className="space-y-0.5">
            {state.search.results.map((r) => {
              const color = NODE_COLORS[r.kind as import('code-intel-shared').NodeKind] ?? '#6b7280';
              return (
                <button
                  key={r.nodeId}
                  onClick={() => {
                    const node = state.nodes.find((n) => n.id === r.nodeId);
                    if (node) dispatch({ type: 'SELECT_NODE', node });
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-800/50 text-left group transition"
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-200 font-medium truncate flex-1 group-hover:text-white">{r.name}</span>
                  <span className="text-[10px] text-gray-600 font-mono">{r.kind}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Graph Composition */}
      <div className="p-3 border-b border-gray-800/50">
        <h3 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-3">
          Graph Composition
        </h3>
        <div className="space-y-2">
          {sortedKinds.map(([kind, n]) => {
            const color = NODE_COLORS[kind as import('code-intel-shared').NodeKind] ?? '#6b7280';
            const pct = (n / maxCount) * 100;
            return (
              <div key={kind}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-gray-300">{kind}</span>
                  </div>
                  <span className="text-gray-500 font-mono tabular-nums">{n}</span>
                </div>
                <div className="h-1 bg-gray-800/80 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick stats */}
      <div className="p-3 border-b border-gray-800/50">
        <h3 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-2">
          Overview
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Nodes', value: state.nodes.length, color: 'text-cyan-400' },
            { label: 'Edges', value: state.edges.length, color: 'text-purple-400' },
            { label: 'Files', value: kindCounts.get('file') ?? 0, color: 'text-blue-400' },
            { label: 'Functions', value: kindCounts.get('function') ?? 0, color: 'text-sky-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-900/50 rounded-lg p-2 border border-gray-800/50">
              <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
              <p className="text-[10px] text-gray-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tip */}
      <div className="p-3">
        <p className="text-[10px] text-gray-600 leading-relaxed">
          <span className="text-gray-400 font-mono">⌘K</span> to search.
          Click nodes to inspect. Toggle <span className="text-cyan-500">⚡ vec</span> for semantic search.
          Use <span className="text-gray-400">Filters</span> to show/hide node types.
        </p>
      </div>
    </div>
  );
}

function GroupTab() {
  const { state, dispatch } = useAppState();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  const handleSyncFull = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const client = new ApiClient(state.serverUrl);
      const result = await client.syncGroup(state.groupName);
      dispatch({
        type: 'SET_GROUP_CONTRACTS',
        contracts: result.contracts as never,
        links: result.links as never,
        syncedAt: result.syncedAt,
      });
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full text-sm">
      {/* Group header */}
      <div className="p-3 border-b border-gray-800/50">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[10px] font-bold tracking-wider text-indigo-400/80 uppercase">
            ⬢ {state.groupName}
          </h3>
          <button
            onClick={handleSyncFull}
            disabled={syncing}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 border border-indigo-800/50 hover:border-indigo-600 rounded px-1.5 py-0.5 transition disabled:opacity-50"
          >
            {syncing ? '⟳ syncing…' : '↻ sync'}
          </button>
        </div>
        {syncError && <p className="text-red-400 text-[10px] mt-1">{syncError}</p>}
        {state.groupSyncedAt && (
          <p className="text-[10px] text-gray-600">
            Last sync: {new Date(state.groupSyncedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Members */}
      <div className="p-3 border-b border-gray-800/50">
        <h3 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-2">
          Members ({state.groupMembers.length})
        </h3>
        <div className="space-y-1">
          {state.groupMembers.map((m) => (
            <div key={m.groupPath} className="bg-gray-900/40 rounded-md px-2 py-1.5 border border-gray-800/30">
              <div className="text-[10px] text-gray-500 font-mono truncate">{m.groupPath}</div>
              <div className="text-xs text-cyan-400 font-medium truncate">{m.registryName}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contracts summary */}
      {state.groupContracts.length > 0 && (
        <div className="p-3 border-b border-gray-800/50">
          <h3 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-2">
            Contracts ({state.groupContracts.length})
          </h3>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {state.groupContracts.slice(0, 30).map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 py-0.5">
                <span className={`text-[9px] px-1 rounded font-mono ${
                  c.kind === 'export' ? 'bg-cyan-900/40 text-cyan-400' :
                  c.kind === 'route' ? 'bg-green-900/40 text-green-400' :
                  c.kind === 'event' ? 'bg-purple-900/40 text-purple-400' :
                  'bg-yellow-900/40 text-yellow-400'
                }`}>{c.kind}</span>
                <span className="text-[10px] text-gray-300 truncate">{c.name}</span>
                <span className="text-[10px] text-gray-600 ml-auto shrink-0">{c.repoName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-links */}
      {state.groupLinks.length > 0 && (
        <div className="p-3">
          <h3 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-2">
            Cross-repo Links ({state.groupLinks.length})
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {state.groupLinks
              .filter((l) => l.confidence >= 0.7)
              .slice(0, 20)
              .map((l, i) => (
                <div key={i} className="bg-gray-900/40 rounded-md px-2 py-1.5 border border-gray-800/30 text-[10px]">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-green-400 font-mono">{l.providerRepo}</span>
                    <span className="text-gray-600">∷</span>
                    <span className="text-white truncate">{l.providerContract}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-600 pl-3">↔</span>
                    <span className="text-indigo-400 font-mono">{l.consumerRepo}</span>
                    <span className="text-gray-600">∷</span>
                    <span className="text-white truncate">{l.consumerContract}</span>
                    <span className="ml-auto text-gray-600">{(l.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {state.groupContracts.length === 0 && state.groupMembers.length > 0 && (
        <div className="p-3 text-center">
          <p className="text-[10px] text-gray-600">No contract data yet.</p>
          <p className="text-[10px] text-gray-600 mt-1">Click ↻ sync to extract contracts.</p>
        </div>
      )}
    </div>
  );
}
