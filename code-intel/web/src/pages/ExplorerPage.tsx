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
import { GroupPanel } from '../components/panels/GroupPanel';
import { StatusFooter } from '../components/shared/StatusFooter';
import { Header } from '../components/shared/Header';
import { KeyboardShortcutsModal } from '../components/shared/KeyboardShortcutsModal';
import { NODE_COLORS } from '../graph/colors';

type SidebarTab = 'explorer' | 'filters' | 'files' | 'query' | 'group' | 'groups';

export function ExplorerPage() {
  const { state, dispatch } = useAppState();
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer');
  const [aiOpen, setAiOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (e.key === '?' && !inInput) setShortcutsOpen((v) => !v);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (state.selectedNode && state.selectedNode.filePath && state.selectedNode.startLine) {
      setSourcePanelOpen(true);
    } else {
      setSourcePanelOpen(false);
    }
  }, [state.selectedNode?.id]);

  const tabs: SidebarTab[] = [
    'explorer',
    'filters',
    'files',
    'query',
    ...(state.mode === 'group' ? ['group' as SidebarTab] : []),
    'groups',
  ];

  return (
    <div className="flex flex-col h-screen bg-void text-text-primary">
      <Header onToggleAI={() => setAiOpen((v) => !v)} aiOpen={aiOpen} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left sidebar ── */}
        <div className="w-72 bg-deep border-r border-border-subtle flex flex-col shrink-0">
          {/* Tab bar */}
          <div className="flex border-b border-border-subtle overflow-x-auto scrollbar-thin">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 min-w-0 px-2 py-2.5 text-xs font-semibold capitalize tracking-wide transition whitespace-nowrap ${
                  activeTab === tab
                    ? 'text-accent border-b-2 border-accent bg-accent/5'
                    : 'text-text-muted hover:text-text-secondary hover:bg-hover'
                }`}
              >
                {tab === 'group'
                  ? '⬢ group'
                  : tab === 'groups'
                  ? '⬡ groups'
                  : tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'explorer' && <ExplorerTab />}
            {activeTab === 'filters' && <SidebarFilters />}
            {activeTab === 'files' && <SidebarFiles />}
            {activeTab === 'query' && <QueryPanel />}
            {activeTab === 'group' && state.mode === 'group' && <GroupTab />}
            {activeTab === 'groups' && <GroupPanel />}
          </div>
        </div>

        {/* ── Center: graph + panels ── */}
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
              onClose={() => setSourcePanelOpen(false)}
            />
          )}
        </div>

        {/* ── Right sidebar: AI chat ── */}
        {aiOpen && (
          <div className="w-96 border-l border-border-subtle flex flex-col shrink-0">
            <SidebarChat />
          </div>
        )}
      </div>

      <StatusFooter />
    </div>
  );
}

// ── Explorer tab ──────────────────────────────────────────────────────────────

function ExplorerTab() {
  const { state, dispatch } = useAppState();

  const kindCounts = new Map<string, number>();
  for (const n of state.nodes) kindCounts.set(n.kind, (kindCounts.get(n.kind) ?? 0) + 1);
  const sortedKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCount = sortedKinds[0]?.[1] ?? 1;

  return (
    <div className="overflow-y-auto scrollbar-thin h-full text-sm">
      {/* Search results */}
      {state.search.results.length > 0 && (
        <div className="p-3 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
              Search Results
            </h3>
            <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-mono">
              {state.search.results.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted mb-2 truncate">"{state.search.query}"</p>
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
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover text-left group transition"
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs text-text-secondary font-medium truncate flex-1 group-hover:text-text-primary">{r.name}</span>
                  <span className="text-[10px] text-text-muted font-mono">{r.kind}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Graph composition */}
      <div className="p-3 border-b border-border-subtle">
        <h3 className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-3">
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
                    <span className="text-text-secondary">{kind}</span>
                  </div>
                  <span className="text-text-muted font-mono tabular-nums">{n}</span>
                </div>
                <div className="h-1 bg-elevated rounded-full overflow-hidden">
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

      {/* Overview stats */}
      <div className="p-3 border-b border-border-subtle">
        <h3 className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-2">
          Overview
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Nodes',     value: state.nodes.length,               color: 'text-accent' },
            { label: 'Edges',     value: state.edges.length,               color: 'text-node-interface' },
            { label: 'Files',     value: kindCounts.get('file') ?? 0,      color: 'text-node-file' },
            { label: 'Functions', value: kindCounts.get('function') ?? 0,  color: 'text-node-function' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface rounded-lg p-2 border border-border-subtle">
              <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
              <p className="text-[10px] text-text-muted">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tip */}
      <div className="p-3">
        <p className="text-[10px] text-text-muted leading-relaxed">
          <span className="text-text-secondary font-mono">⌘K</span> to search.
          Click nodes to inspect. Use <span className="text-text-secondary">Filters</span> to show/hide node types.
          Press <span className="text-text-secondary font-mono">?</span> for shortcuts.
        </p>
      </div>
    </div>
  );
}

// ── Group tab ─────────────────────────────────────────────────────────────────

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
    <div className="overflow-y-auto scrollbar-thin h-full text-sm">
      {/* Header */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
            ⬢ {state.groupName}
          </h3>
          <button
            onClick={handleSyncFull}
            disabled={syncing}
            className="text-[10px] text-accent hover:text-accent/80 border border-accent/30 hover:border-accent/60 rounded px-1.5 py-0.5 transition disabled:opacity-50"
          >
            {syncing ? '⟳ syncing…' : '↻ sync'}
          </button>
        </div>
        {syncError && <p className="text-red-400 text-[10px] mt-1">{syncError}</p>}
        {state.groupSyncedAt && (
          <p className="text-[10px] text-text-muted">
            Last sync: {new Date(state.groupSyncedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Members */}
      <div className="p-3 border-b border-border-subtle">
        <h3 className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-2">
          Members ({state.groupMembers.length})
        </h3>
        <div className="space-y-1">
          {state.groupMembers.map((m) => (
            <div key={m.groupPath} className="bg-surface rounded-md px-2 py-1.5 border border-border-subtle">
              <div className="text-[10px] text-text-muted font-mono truncate">{m.groupPath}</div>
              <div className="text-xs text-accent font-medium truncate">{m.registryName}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Contracts */}
      {state.groupContracts.length > 0 && (
        <div className="p-3 border-b border-border-subtle">
          <h3 className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-2">
            Contracts ({state.groupContracts.length})
          </h3>
          <div className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-thin">
            {state.groupContracts.slice(0, 30).map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 py-0.5">
                <span className={`text-[9px] px-1 rounded font-mono ${
                  c.kind === 'export' ? 'bg-accent/20 text-accent' :
                  c.kind === 'route'  ? 'bg-node-function/20 text-node-function' :
                  c.kind === 'event'  ? 'bg-node-interface/20 text-node-interface' :
                  'bg-elevated text-text-muted'
                }`}>{c.kind}</span>
                <span className="text-[10px] text-text-secondary truncate">{c.name}</span>
                <span className="text-[10px] text-text-muted ml-auto shrink-0">{c.repoName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-links */}
      {state.groupLinks.length > 0 && (
        <div className="p-3">
          <h3 className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-2">
            Cross-repo Links ({state.groupLinks.length})
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
            {state.groupLinks
              .filter((l) => l.confidence >= 0.7)
              .slice(0, 20)
              .map((l, i) => (
                <div key={i} className="bg-surface rounded-md px-2 py-1.5 border border-border-subtle text-[10px]">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-node-function font-mono">{l.providerRepo}</span>
                    <span className="text-text-muted">∷</span>
                    <span className="text-text-primary truncate">{l.providerContract}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-text-muted pl-3">↔</span>
                    <span className="text-accent font-mono">{l.consumerRepo}</span>
                    <span className="text-text-muted">∷</span>
                    <span className="text-text-primary truncate">{l.consumerContract}</span>
                    <span className="ml-auto text-text-muted">{(l.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {state.groupContracts.length === 0 && state.groupMembers.length > 0 && (
        <div className="p-3 text-center">
          <p className="text-[10px] text-text-muted">No contract data yet.</p>
          <p className="text-[10px] text-text-muted mt-1">Click ↻ sync to extract contracts.</p>
        </div>
      )}
    </div>
  );
}
