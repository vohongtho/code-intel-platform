import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import { AppProvider, useAppState } from './state/app-context';
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

function AppContent() {
  const { state } = useAppState();
  const authed = Boolean(state.currentUser);

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
