import React from 'react';
import { AppProvider, useAppState } from './state/app-context';
import { ConnectPage } from './pages/ConnectPage';
import { LoadingPage } from './pages/LoadingPage';
import { ExplorerPage } from './pages/ExplorerPage';

function AppContent() {
  const { state } = useAppState();

  switch (state.view) {
    case 'connect':
      return <ConnectPage />;
    case 'loading':
      return <LoadingPage />;
    case 'exploring':
      return <ExplorerPage />;
  }
}

export function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
