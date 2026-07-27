import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App } from './App';

const authStatusMock = vi.fn();
const vectorStatusMock = vi.fn().mockResolvedValue({ ready: false, building: false });

vi.mock('./api/client', () => ({
  ApiClient: class {
    authStatus = authStatusMock;
    vectorStatus = vectorStatusMock;
    listRepos = vi.fn();
    fetchGraph = vi.fn();
    fetchGraphNodes = vi.fn();
  },
}));

vi.mock('./pages/LoginPage', () => ({ LoginPage: () => <div>LoginPage</div> }));
vi.mock('./pages/ConnectPage', () => ({ ConnectPage: () => <div>ConnectPage</div> }));
vi.mock('./pages/LoadingPage', () => ({ LoadingPage: () => <div>LoadingPage</div> }));
vi.mock('./pages/ExplorerPage', () => ({ ExplorerPage: () => <div>ExplorerPage</div> }));
vi.mock('./pages/SettingsPage', () => ({ SettingsPage: () => <div>SettingsPage</div> }));

function shouldRestoreWorkspaceForPath(pathname: string): boolean {
  return pathname === '/explore' || pathname === '/loading';
}

function loadingRefreshFallback(pathname: string, connected: boolean, graphLoadPresent: boolean): '/explore' | '/connect' | null {
  if (pathname !== '/loading' || graphLoadPresent) return null;
  return connected ? '/explore' : '/connect';
}

describe('loading route restore helpers', () => {
  beforeEach(() => {
    authStatusMock.mockReset();
    vectorStatusMock.mockClear();
  });

  it('restores workspace for /explore', () => {
    expect(shouldRestoreWorkspaceForPath('/explore')).toBe(true);
  });

  it('restores workspace for /loading', () => {
    expect(shouldRestoreWorkspaceForPath('/loading')).toBe(true);
  });

  it('does not restore workspace for /connect', () => {
    expect(shouldRestoreWorkspaceForPath('/connect')).toBe(false);
  });

  it('redirects /loading refresh to /connect when not connected and no progress', () => {
    expect(loadingRefreshFallback('/loading', false, false)).toBe('/connect');
  });

  it('redirects /loading refresh to /explore when connected and no progress', () => {
    expect(loadingRefreshFallback('/loading', true, false)).toBe('/explore');
  });

  it('keeps /loading when progress exists', () => {
    expect(loadingRefreshFallback('/loading', false, true)).toBeNull();
  });
});

describe('App loading route integration', () => {
  beforeEach(() => {
    authStatusMock.mockReset();
    vectorStatusMock.mockClear();
  });

  it('redirects refreshed /loading route to /connect when session is restored without workspace state', async () => {
    authStatusMock.mockResolvedValue({
      authenticated: true,
      user: { id: 'u1', username: 'admin', role: 'admin' },
    });

    window.history.replaceState({}, '', '/loading');
    render(
      <MemoryRouter initialEntries={['/loading']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('ConnectPage')).toBeInTheDocument();
    });
    expect(screen.queryByText('LoadingPage')).not.toBeInTheDocument();
    expect(screen.queryByText('Building knowledge graph…')).not.toBeInTheDocument();
  });
});
