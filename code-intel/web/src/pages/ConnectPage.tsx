import React, { useEffect, useState } from 'react';
import { useAppState } from '../state/app-context';
import { ApiClient } from '../api/client';
import type { AppState } from '../state/types';

type ConnectTab = 'repo' | 'group';

export function ConnectPage() {
  const { dispatch } = useAppState();

  const defaultUrl =
    window.location.port === '5173' || window.location.port === '5174'
      ? 'http://localhost:4747'
      : window.location.origin;

  const [url, setUrl] = useState(defaultUrl);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<ConnectTab>('repo');
  const [repos, setRepos] = useState<{ name: string; path: string; nodes: number; edges: number; indexedAt: string | null; active?: boolean }[]>([]);
  const [groups, setGroups] = useState<{ name: string; memberCount: number; lastSync: string | null; createdAt: string }[]>([]);
  const [repoSearch, setRepoSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [connectingGroup, setConnectingGroup] = useState<string | null>(null);

  useEffect(() => {
    probeServer(defaultUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const probeServer = async (probeUrl: string) => {
    try {
      const client = new ApiClient(probeUrl);
      const list = await client.listRepos();
      setRepos(list);
      setError('');
    } catch {
      setRepos([]);
    }
  };

  useEffect(() => {
    if (tab === 'group') loadGroups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, url]);

  const loadGroups = async () => {
    setLoadingGroups(true);
    try {
      const client = new ApiClient(url);
      const list = await client.listGroups();
      setGroups(list);
    } catch {
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleConnectRepo = async (repoName: string) => {
    setError('');
    setConnecting(true);
    try {
      const client = new ApiClient(url);
      dispatch({ type: 'SET_SERVER_URL', url });
      dispatch({ type: 'SET_MODE', mode: 'repo' });
      dispatch({ type: 'SET_REPO_NAME', name: repoName });
      dispatch({ type: 'SET_VIEW', view: 'loading' });

      const PAGE = 200;

      // Phase 1: fetch edges + first node page in parallel (both are fast)
      dispatch({ type: 'SET_GRAPH_LOAD', progress: { loaded: 0, total: 0, phase: 'edges' } });
      const [fullGraph, firstPage] = await Promise.all([
        client.fetchGraph(repoName),
        client.fetchGraphNodes(repoName, 0, PAGE),
      ]);

      const total = firstPage.total;
      const allNodes = [...firstPage.nodes];
      const allIds = new Set(allNodes.map((n) => n.id));

      dispatch({ type: 'SET_GRAPH_LOAD', progress: { loaded: allNodes.length, total, phase: 'nodes' } });

      // Phase 2: fetch ALL remaining pages in parallel
      if (firstPage.hasMore) {
        // Build every offset we still need
        const offsets: number[] = [];
        for (let off = PAGE; off < total; off += PAGE) offsets.push(off);

        // Fire all requests concurrently in batches of 8 to avoid overwhelming the server
        const CONCURRENCY = 8;
        for (let i = 0; i < offsets.length; i += CONCURRENCY) {
          const batch = offsets.slice(i, i + CONCURRENCY);
          const pages = await Promise.all(
            batch.map(off => client.fetchGraphNodes(repoName, off, PAGE).catch(() => null))
          );
          for (const page of pages) {
            if (!page) continue;
            for (const n of page.nodes) {
              if (!allIds.has(n.id)) { allIds.add(n.id); allNodes.push(n); }
            }
          }
          dispatch({ type: 'SET_GRAPH_LOAD', progress: { loaded: allNodes.length, total, phase: 'nodes' } });
        }
      }

      // All nodes loaded — render the full graph at once (single FA2 run, no re-layout)
      dispatch({ type: 'SET_GRAPH_LOAD', progress: null });
      dispatch({ type: 'SET_GRAPH', nodes: allNodes, edges: fullGraph.edges });
      dispatch({ type: 'SET_CONNECTED', connected: true });
      dispatch({ type: 'SET_VIEW', view: 'exploring' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      dispatch({ type: 'SET_GRAPH_LOAD', progress: null });
      dispatch({ type: 'SET_VIEW', view: 'connect' });
      setConnecting(false);
    }
  };

  const handleConnectGroup = async (groupName: string) => {
    setError('');
    setConnectingGroup(groupName);
    try {
      const client = new ApiClient(url);
      dispatch({ type: 'SET_SERVER_URL', url });
      dispatch({ type: 'SET_VIEW', view: 'loading' });

      const [groupConfig, graphData] = await Promise.all([
        client.getGroup(groupName),
        client.fetchGroupGraph(groupName),
      ]);

      dispatch({ type: 'SET_MODE', mode: 'group' });
      dispatch({ type: 'SET_GROUP_NAME', name: groupName });
      dispatch({ type: 'SET_GROUP_MEMBERS', members: groupConfig.members });
      dispatch({ type: 'SET_REPO_NAME', name: groupName });
      dispatch({ type: 'SET_GRAPH', nodes: graphData.nodes, edges: graphData.edges });
      dispatch({ type: 'SET_CONNECTED', connected: true });
      dispatch({ type: 'SET_VIEW', view: 'exploring' });

      client.getGroupContracts(groupName).then((contracts) => {
        if (contracts) {
          dispatch({
            type: 'SET_GROUP_CONTRACTS',
            contracts: contracts.contracts as AppState['groupContracts'],
            links: contracts.links as AppState['groupLinks'],
            syncedAt: contracts.syncedAt,
          });
        }
      }).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group');
      dispatch({ type: 'SET_VIEW', view: 'connect' });
    } finally {
      setConnectingGroup(null);
    }
  };

  const inputClass =
    'w-full bg-elevated text-text-primary rounded-lg px-4 py-2.5 border border-border-default focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 placeholder-text-muted transition disabled:opacity-50 text-sm';

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    r.path.toLowerCase().includes(repoSearch.toLowerCase())
  );
  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(groupSearch.toLowerCase())
  );

  return (
    <div className="flex items-center justify-center min-h-screen bg-void p-4">
      <div className="bg-deep border border-border-subtle rounded-2xl shadow-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>

        {/* Logo — compact */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center text-white text-xl font-bold shadow-glow select-none shrink-0">
            ◈
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary tracking-tight leading-tight">Code Intel</h1>
            <p className="text-text-muted text-xs">Knowledge Graph Explorer</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-surface mx-4 rounded-lg p-0.5 mb-3 border border-border-subtle shrink-0">
          {(['repo', 'group'] as ConnectTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition ${
                tab === t
                  ? 'bg-gradient-to-r from-accent to-accent-dim text-white shadow'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {t === 'repo' ? '⬡ Repository' : '⬢ Group'}
            </button>
          ))}
        </div>

        {/* URL input */}
        <div className="px-4 mb-3 shrink-0">
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); probeServer(e.target.value); }}
            disabled={connecting || connectingGroup !== null}
            className={inputClass}
            placeholder="http://localhost:4747"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-red-950/40 border border-red-800/50 px-3 py-2 shrink-0">
            <svg className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-red-400 text-xs leading-snug">{error}</p>
          </div>
        )}

        {/* ── Repo tab ── */}
        {tab === 'repo' && (
          <div className="flex flex-col min-h-0 flex-1 px-4 pb-4">
            {repos.length > 0 ? (
              <>
                {/* Search + count header */}
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-xs pointer-events-none">⌕</span>
                    <input
                      type="text"
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      placeholder="Filter repos…"
                      className="w-full bg-surface border border-border-subtle rounded-lg pl-7 pr-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                    />
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0 tabular-nums">
                    {filteredRepos.length}/{repos.length}
                  </span>
                </div>

                {/* Scrollable repo list */}
                <div className="overflow-y-auto scrollbar-thin space-y-1.5 flex-1">
                  {filteredRepos.length === 0 ? (
                    <div className="text-center py-6 text-text-muted text-xs">No repos match "{repoSearch}"</div>
                  ) : (
                    filteredRepos.map((r) => (
                      <button
                        key={r.name}
                        onClick={() => handleConnectRepo(r.name)}
                        disabled={connecting}
                        className={`w-full flex items-center gap-3 bg-surface hover:bg-hover border rounded-xl px-3 py-2.5 transition group disabled:opacity-50 disabled:cursor-not-allowed text-left ${
                          r.active
                            ? 'border-accent/40 hover:border-accent/60'
                            : 'border-border-subtle hover:border-border-default'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full shrink-0 ${r.active ? 'bg-accent shadow-glow animate-pulse' : 'bg-node-function'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-text-primary truncate">{r.name}</span>
                            {r.active && (
                              <span className="text-[9px] bg-accent/20 text-accent border border-accent/30 px-1 py-px rounded-full font-medium shrink-0">active</span>
                            )}
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5 tabular-nums">{r.nodes.toLocaleString()}n · {r.edges.toLocaleString()}e</div>
                          {r.path && (
                            <div className="text-[9px] text-text-muted/40 font-mono truncate mt-0.5" title={r.path}>{r.path}</div>
                          )}
                        </div>
                        {connecting ? (
                          <Spinner className="w-3.5 h-3.5 text-accent shrink-0" />
                        ) : (
                          <span className="text-text-muted/40 group-hover:text-accent transition text-sm shrink-0">→</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="bg-surface border border-border-subtle rounded-xl px-4 py-6 text-center">
                <p className="text-text-muted text-sm mb-2">No repositories found.</p>
                <p className="text-text-muted/60 text-xs font-mono">code-intel analyze</p>
              </div>
            )}
          </div>
        )}

        {/* ── Group tab ── */}
        {tab === 'group' && (
          <div className="flex flex-col min-h-0 flex-1 px-4 pb-4">
            {loadingGroups ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-sm gap-2">
                <Spinner className="w-4 h-4" />
                Loading groups…
              </div>
            ) : groups.length === 0 ? (
              <div className="bg-surface border border-border-subtle rounded-xl px-4 py-6 text-center">
                <p className="text-text-muted text-sm mb-2">No groups found.</p>
                <p className="text-text-muted/60 text-xs font-mono">code-intel group create &lt;name&gt;</p>
              </div>
            ) : (
              <>
                {/* Search + refresh */}
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-xs pointer-events-none">⌕</span>
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Filter groups…"
                      className="w-full bg-surface border border-border-subtle rounded-lg pl-7 pr-3 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition"
                    />
                  </div>
                  <button
                    onClick={loadGroups}
                    disabled={loadingGroups}
                    className="text-xs text-accent hover:text-accent/80 transition disabled:opacity-50 shrink-0"
                    title="Refresh"
                  >
                    ↻
                  </button>
                  <span className="text-[10px] text-text-muted shrink-0 tabular-nums">
                    {filteredGroups.length}/{groups.length}
                  </span>
                </div>

                {/* Scrollable group list */}
                <div className="overflow-y-auto scrollbar-thin space-y-1.5 flex-1">
                  {filteredGroups.length === 0 ? (
                    <div className="text-center py-6 text-text-muted text-xs">No groups match "{groupSearch}"</div>
                  ) : (
                    filteredGroups.map((g) => (
                      <button
                        key={g.name}
                        onClick={() => handleConnectGroup(g.name)}
                        disabled={connectingGroup !== null}
                        className="w-full flex items-center gap-3 bg-surface hover:bg-hover border border-border-subtle hover:border-accent/40 rounded-xl px-3 py-2.5 transition group disabled:opacity-50 disabled:cursor-not-allowed text-left"
                      >
                        <span className="text-accent text-base shrink-0">⬢</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-text-primary truncate">{g.name}</span>
                            {connectingGroup === g.name && <Spinner className="w-3 h-3 text-accent shrink-0" />}
                          </div>
                          <div className="text-[10px] text-text-muted mt-0.5">
                            {g.memberCount} repo{g.memberCount !== 1 ? 's' : ''}
                            {g.lastSync
                              ? ` · synced ${new Date(g.lastSync).toLocaleDateString()}`
                              : ' · not synced'}
                          </div>
                        </div>
                        <span className="text-text-muted/40 group-hover:text-accent transition text-sm shrink-0">→</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
