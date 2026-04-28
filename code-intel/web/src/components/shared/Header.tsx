import React, { useEffect, useRef, useState } from 'react';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';
import { NODE_COLORS } from '../../graph/colors';
import type { NodeKind } from '@code-intel/shared';

interface Props {
  onToggleAI: () => void;
  aiOpen: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'text-red-400 border-red-700/50 bg-red-900/20',
  analyst: 'text-cyan-400 border-cyan-700/50 bg-cyan-900/20',
  viewer: 'text-gray-400 border-gray-700/50 bg-gray-800/30',
  'repo-owner': 'text-indigo-400 border-indigo-700/50 bg-indigo-900/20',
};

export function Header({ onToggleAI, aiOpen }: Props) {
  const { state, dispatch } = useAppState();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [vectorMode, setVectorMode] = useState(false);
  const [vectorReady, setVectorReady] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Poll vector status
  useEffect(() => {
    if (!state.connected) return;
    const check = async () => {
      try {
        const client = new ApiClient(state.serverUrl);
        const status = await client.vectorStatus();
        setVectorReady(status.ready);
        if (!status.ready && status.building) setTimeout(check, 3000);
      } catch { /* ignore */ }
    };
    check();
  }, [state.connected, state.serverUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') { setOpen(false); setUserMenuOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close user menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  const handleSearch = async (q: string) => {
    if (!q.trim()) { setOpen(false); return; }
    setSearching(true);
    try {
      const client = new ApiClient(state.serverUrl);
      if (vectorMode && vectorReady) {
        const { results, source } = await client.vectorSearch(q, 12);
        dispatch({ type: 'SET_SEARCH', query: q, results });
        console.log('[search] vector source:', source);
      } else {
        const { results } = await client.search(q, 12);
        dispatch({ type: 'SET_SEARCH', query: q, results });
      }
      setOpen(true);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const client = new ApiClient(state.serverUrl);
      await client.logout();
    } catch { /* ignore */ } finally {
      dispatch({ type: 'SET_CURRENT_USER', user: null });
      dispatch({ type: 'SET_CONNECTED', connected: false });
      dispatch({ type: 'SET_GRAPH', nodes: [], edges: [] });
      dispatch({ type: 'SET_VIEW', view: 'login' });
      setLoggingOut(false);
      setUserMenuOpen(false);
    }
  };

  const user = state.currentUser;

  return (
    <div className="h-12 bg-[#0a0a0f] border-b border-gray-800 flex items-center px-4 gap-4 relative z-30">
      {/* Logo + repo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
          ◈
        </div>
        <span className="text-white font-semibold tracking-tight">Code Intel</span>
        {state.repoName && (
          <>
            <span className="text-gray-600">·</span>
            {state.mode === 'group' ? (
              <span className="flex items-center gap-1">
                <span className="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-700/50 rounded px-1.5 py-0.5 font-mono">group</span>
                <span className="text-cyan-400 text-sm font-mono">{state.repoName}</span>
              </span>
            ) : (
              <span className="text-cyan-400 text-sm font-mono">{state.repoName}</span>
            )}
          </>
        )}
      </div>

      {/* Search */}
      <div className="flex-1 max-w-2xl mx-auto relative">
        <div className="relative flex items-center gap-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm z-10">
            {searching ? <span className="animate-spin inline-block">⟳</span> : '⌕'}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(state.search.results.length > 0 || query.length > 0)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch(query);
              if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
            }}
            placeholder={vectorMode && vectorReady ? 'Semantic search…' : 'Search nodes…'}
            className="w-full bg-gray-900/80 border border-gray-700 rounded-lg pl-9 pr-28 py-1.5 text-sm text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none"
          />
          {/* Vector mode toggle */}
          <button
            onClick={() => setVectorMode((v) => !v)}
            title={
              vectorReady
                ? vectorMode
                  ? 'Switch to keyword search'
                  : 'Switch to vector/semantic search'
                : 'Vector index building…'
            }
            className={`absolute right-14 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded border font-mono transition-all ${
              vectorReady === null
                ? 'text-gray-600 border-gray-700'
                : vectorReady && vectorMode
                  ? 'text-purple-300 border-purple-600 bg-purple-900/30'
                  : vectorReady
                    ? 'text-gray-400 border-gray-700 hover:border-purple-600 hover:text-purple-300'
                    : 'text-yellow-600 border-yellow-800 animate-pulse'
            }`}
          >
            {vectorReady === null ? '…' : vectorReady ? (vectorMode ? '⚡ vec' : 'vec') : '⟳ vec'}
          </button>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs border border-gray-700 rounded px-1.5 py-0.5 font-mono bg-gray-800/60">
            ⌘K
          </span>
        </div>

        {open && state.search.results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-h-96 overflow-y-auto">
            {state.search.results.map((r) => (
              <div
                key={r.nodeId}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer border-b border-gray-800/60 last:border-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const node = state.nodes.find((n) => n.id === r.nodeId);
                  if (node) {
                    dispatch({ type: 'SELECT_NODE', node });
                    setOpen(false);
                  }
                }}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: NODE_COLORS[r.kind as NodeKind] ?? '#666' }}
                />
                <span className="text-sm text-white font-medium truncate">{r.name}</span>
                <span className="text-xs text-gray-500 ml-auto truncate max-w-xs">{r.filePath}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Counts */}
      <div className="flex items-center gap-3 text-xs text-gray-400 font-mono">
        <span>{state.nodes.length.toLocaleString()} nodes</span>
        <span>·</span>
        <span>{state.edges.length.toLocaleString()} edges</span>
      </div>

      {/* AI toggle */}
      <button
        onClick={onToggleAI}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
          aiOpen
            ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white'
            : 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700'
        }`}
      >
        <span>✦</span>
        Code AI
      </button>

      {/* User menu */}
      {user && (
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-800 border border-gray-700/60 transition"
          >
            {/* Avatar */}
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold select-none">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm text-gray-200 max-w-[80px] truncate">{user.username}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${ROLE_COLORS[user.role] ?? ROLE_COLORS['viewer']}`}>
              {user.role}
            </span>
            <svg className={`w-3 h-3 text-gray-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl py-1 z-50">
              {/* User info */}
              <div className="px-4 py-2.5 border-b border-gray-800">
                <p className="text-sm text-white font-semibold">{user.username}</p>
                <p className="text-xs text-gray-500 mt-0.5 capitalize">{user.role}</p>
              </div>
              {/* Switch repo */}
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  dispatch({ type: 'SET_CONNECTED', connected: false });
                  dispatch({ type: 'SET_VIEW', view: 'connect' });
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition flex items-center gap-2"
              >
                <span className="text-gray-500">⬡</span>
                Switch Repository
              </button>
              {/* Logout */}
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-950/30 hover:text-red-300 transition flex items-center gap-2 disabled:opacity-50"
              >
                {loggingOut ? (
                  <span className="animate-spin inline-block text-xs">⟳</span>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                )}
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
