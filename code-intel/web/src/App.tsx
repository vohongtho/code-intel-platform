import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { AppProvider, useAppState } from './state/app-context';
import { ApiClient } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { ConnectPage } from './pages/ConnectPage';
import { LoadingPage } from './pages/LoadingPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { SettingsPage } from './pages/SettingsPage';
import { getSettingsSectionFromPath } from './routing';

function RouteSync() {
  const { state, dispatch } = useAppState();
  const location = useLocation();

  useEffect(() => {
    const settingsSection = getSettingsSectionFromPath(location.pathname);
    if (settingsSection) {
      if (state.view !== 'settings') dispatch({ type: 'SET_VIEW', view: 'settings' });
      return;
    }

    if (location.pathname === '/loading' && state.view !== 'loading') {
      dispatch({ type: 'SET_VIEW', view: 'loading' });
      return;
    }
    if (location.pathname === '/connect' && state.view !== 'connect') {
      dispatch({ type: 'SET_VIEW', view: 'connect' });
      return;
    }
    if (location.pathname === '/explore' && state.view !== 'exploring') {
      dispatch({ type: 'SET_VIEW', view: 'exploring' });
      return;
    }
    if (location.pathname === '/login' && state.view !== 'login') {
      dispatch({ type: 'SET_VIEW', view: 'login' });
    }
  }, [dispatch, location.pathname, state.view]);

  return null;
}

export function shouldRestoreWorkspaceForPath(pathname: string): boolean {
  return pathname === '/explore' || pathname === '/loading';
}

export function loadingRefreshFallback(pathname: string, connected: boolean, graphLoadPresent: boolean): '/explore' | '/connect' | null {
  if (pathname !== '/loading' || graphLoadPresent) return null;
  return connected ? '/explore' : '/connect';
}

function AppContent() {
  const { state, dispatch } = useAppState();
  const location = useLocation();
  const [authResolved, setAuthResolved] = useState(false);
  const authed = Boolean(state.currentUser);

  useEffect(() => {
    const defaultUrl =
      window.location.port === '5173' || window.location.port === '5174'
        ? 'http://localhost:4747'
        : window.location.origin;

    const serverUrl = state.serverUrl || defaultUrl;
    const client = new ApiClient(serverUrl);
    const needsWorkspaceRestore = shouldRestoreWorkspaceForPath(location.pathname);

    (async () => {
      try {
        const status = await client.authStatus();
        dispatch({ type: 'SET_SERVER_URL', url: serverUrl });
        if (status.authenticated && status.user) {
          dispatch({ type: 'SET_CURRENT_USER', user: status.user });

          if (needsWorkspaceRestore && !state.connected) {
            try {
              const repos = await client.listRepos();
              const activeRepo = repos.find((repo) => repo.active) ?? repos[0];
              if (activeRepo) {
                const PAGE = 200;
                const [fullGraph, firstPage] = await Promise.all([
                  client.fetchGraph(activeRepo.name),
                  client.fetchGraphNodes(activeRepo.name, 0, PAGE),
                ]);

                const total = firstPage.total;
                const allNodes = [...firstPage.nodes];
                const allIds = new Set(allNodes.map((n) => n.id));

                if (firstPage.hasMore) {
                  const offsets: number[] = [];
                  for (let off = PAGE; off < total; off += PAGE) offsets.push(off);

                  const CONCURRENCY = 8;
                  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
                    const batch = offsets.slice(i, i + CONCURRENCY);
                    const pages = await Promise.all(
                      batch.map((off) => client.fetchGraphNodes(activeRepo.name, off, PAGE).catch(() => null))
                    );
                    for (const page of pages) {
                      if (!page) continue;
                      for (const n of page.nodes) {
                        if (!allIds.has(n.id)) {
                          allIds.add(n.id);
                          allNodes.push(n);
                        }
                      }
                    }
                  }
                }

                dispatch({ type: 'SET_MODE', mode: 'repo' });
                dispatch({ type: 'SET_REPO_NAME', name: activeRepo.name });
                dispatch({ type: 'SET_GRAPH', nodes: allNodes, edges: fullGraph.edges });
                dispatch({ type: 'SET_CONNECTED', connected: true });
              }
            } catch {
              // leave graph empty; route still stays stable after session restore
            }
          }
        }
      } catch {
        // ignore bootstrap check failures; route guards will treat as logged out
      } finally {
        setAuthResolved(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authResolved) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-void">
        <div className="flex items-center gap-3 text-text-muted">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-sm">Restoring session…</span>
        </div>
      </div>
    );
  }

  const loadingFallback = authed
    ? loadingRefreshFallback(location.pathname, state.connected, Boolean(state.graphLoad))
    : null;

  if (loadingFallback) {
    return <Navigate to={loadingFallback} replace />;
  }

  if (authed && shouldRestoreWorkspaceForPath(location.pathname) && !state.connected) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-void">
        <div className="flex items-center gap-3 text-text-muted">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-sm">Restoring workspace…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <RouteSync />
      <Routes>
        <Route path="/login" element={authed ? <Navigate to="/connect" replace /> : <LoginPage />} />
        <Route path="/connect" element={authed ? <ConnectPage /> : <Navigate to="/login" replace />} />
        <Route path="/loading" element={authed ? <LoadingPage /> : <Navigate to="/login" replace />} />
        <Route path="/explore" element={authed ? <ExplorerPage /> : <Navigate to="/login" replace />} />
        <Route path="/settings/:section?" element={authed ? <SettingsPage /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to={authed ? '/connect' : '/login'} replace />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
