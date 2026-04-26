import React, { useState, useEffect } from 'react';
import { useAppState } from '../state/app-context';
import { GraphView } from '../components/graph/GraphView';
import { NodeDetail } from '../components/panels/NodeDetail';
import { SidebarChat } from '../components/panels/SidebarChat';
import { SidebarFiles } from '../components/panels/SidebarFiles';
import { SidebarFilters } from '../components/panels/SidebarFilters';
import { StatusFooter } from '../components/shared/StatusFooter';
import { Header } from '../components/shared/Header';
import { KeyboardShortcutsModal } from '../components/shared/KeyboardShortcutsModal';
import { NODE_COLORS } from '../graph/colors';

type SidebarTab = 'explorer' | 'filters' | 'files';

export function ExplorerPage() {
  const { state, dispatch } = useAppState();
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const [aiOpen, setAiOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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

  return (
    <div className="flex flex-col h-screen bg-[#040812] text-white">
      <Header onToggleAI={() => setAiOpen((v) => !v)} aiOpen={aiOpen} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-72 bg-[#080b14] border-r border-gray-800/50 flex flex-col">
          <div className="flex border-b border-gray-800/50">
            {(['explorer', 'filters', 'files'] as SidebarTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-2.5 text-xs font-semibold capitalize tracking-wide transition ${
                  activeTab === tab
                    ? 'text-cyan-400 border-b-2 border-cyan-500 bg-cyan-500/5'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTab === 'explorer' && <ExplorerTab />}
            {activeTab === 'filters' && <SidebarFilters />}
            {activeTab === 'files' && <SidebarFiles />}
          </div>
        </div>

        {/* Center: Graph + NodeDetail */}
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
              const color = NODE_COLORS[r.kind as import('@code-intel/shared').NodeKind] ?? '#6b7280';
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
            const color = NODE_COLORS[kind as import('@code-intel/shared').NodeKind] ?? '#6b7280';
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
