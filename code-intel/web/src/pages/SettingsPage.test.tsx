import React, { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AppProvider, useAppState } from '../state/app-context';
import { SettingsPage } from './SettingsPage';
import { Header } from '../components/shared/Header';
import type { CurrentUser } from '../state/types';

const getConfigMock = vi.fn();
const saveConfigMock = vi.fn();
const listEmbeddingModelsMock = vi.fn();
const logoutMock = vi.fn();
const vectorStatusMock = vi.fn().mockResolvedValue({ ready: false, building: false });

vi.mock('../api/client', () => ({
  ApiClient: class {
    getConfig = getConfigMock;
    saveConfig = saveConfigMock;
    listEmbeddingModels = listEmbeddingModelsMock;
    logout = logoutMock;
    vectorStatus = vectorStatusMock;
  },
}));

const adminUser: CurrentUser = {
  id: 'u-admin',
  username: 'admin',
  role: 'admin',
};

const viewerUser: CurrentUser = {
  id: 'u-viewer',
  username: 'viewer',
  role: 'viewer',
};

const defaultConfig = {
  llm: { provider: 'ollama', model: 'llama3', apiKey: '', baseUrl: '', batchSize: 20, maxTokensPerSummary: 100 },
  embeddings: { model: 'Xenova/all-MiniLM-L6-v2', enabled: false },
  analysis: { maxFileSizeKB: 512, ignorePatterns: [], incrementalByDefault: false },
  serve: { defaultPort: 4747, openBrowser: true },
  auth: { mode: 'local' as const },
  updates: { checkOnStartup: true, intervalHours: 24 },
  telemetry: { enabled: false },
};

function SeedState({ user = adminUser, connected = true }: { user?: CurrentUser | null; connected?: boolean }) {
  const { dispatch } = useAppState();
  useEffect(() => {
    dispatch({ type: 'SET_CURRENT_USER', user });
    dispatch({ type: 'SET_CONNECTED', connected });
    dispatch({ type: 'SET_VIEW', view: connected ? 'exploring' : 'connect' });
    dispatch({ type: 'SET_SERVER_URL', url: 'http://localhost:4747' });
    dispatch({ type: 'SET_REPO_NAME', name: 'demo-repo' });
  }, [connected, dispatch, user]);
  return null;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSettingsRoute(route: string, user: CurrentUser | null = adminUser) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProvider>
        <SeedState user={user} connected={true} />
        <Routes>
          <Route path="/settings/:section?" element={<SettingsPage />} />
        </Routes>
        <LocationProbe />
      </AppProvider>
    </MemoryRouter>,
  );
}

function renderHeader(user: CurrentUser = adminUser) {
  return render(
    <MemoryRouter initialEntries={['/explore']}>
      <AppProvider>
        <SeedState user={user} connected={true} />
        <Header onToggleAI={() => {}} aiOpen={false} />
      </AppProvider>
    </MemoryRouter>,
  );
}

describe('SettingsPage routing and save flow', () => {
  beforeEach(() => {
    getConfigMock.mockReset();
    saveConfigMock.mockReset();
    logoutMock.mockReset();
    vectorStatusMock.mockClear();
    listEmbeddingModelsMock.mockReset();
    getConfigMock.mockResolvedValue({ config: defaultConfig });
    listEmbeddingModelsMock.mockResolvedValue({
      defaultModel: 'Xenova/all-MiniLM-L6-v2',
      models: [{
        id: 'Xenova/all-MiniLM-L6-v2',
        label: 'all-MiniLM-L6-v2',
        provider: 'huggingface-transformers',
        dimension: 384,
        dtype: 'q8',
        default: true,
        available: true,
      }],
    });
  });

  it('redirects bare /settings to /settings/overview', async () => {
    renderSettingsRoute('/settings');
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/overview');
    });
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('navigates sections through router links', async () => {
    renderSettingsRoute('/settings/overview');
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'LLM' }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/settings/llm');
    });
    expect(screen.getByRole('combobox', { name: /provider/i })).toBeInTheDocument();
  });

  it('shows validation errors on failed save for admin', async () => {
    saveConfigMock.mockRejectedValue(Object.assign(new Error('Config validation failed'), {
      validationErrors: [{ path: 'llm.provider', reason: 'Value "bad" is not allowed.', hint: 'Set a valid provider' }],
    }));

    renderSettingsRoute('/settings/llm', adminUser);
    const provider = await screen.findByRole('combobox', { name: /provider/i });
    fireEvent.change(provider, { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('Validation errors')).toBeInTheDocument();
    expect(screen.getByText(/llm.provider/i)).toBeInTheDocument();
  });

  it('renders read-only save state for viewer', async () => {
    renderSettingsRoute('/settings/server', viewerUser);
    expect(await screen.findByText('Read-only for this role.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('renders embeddings model as select, not text input', async () => {
    renderSettingsRoute('/settings/embeddings', adminUser);
    expect(await screen.findByRole('combobox', { name: /model/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /model/i })).not.toBeInTheDocument();
  });

  it('renders unsupported legacy model option and blocks saving when enabled', async () => {
    getConfigMock.mockResolvedValue({ config: { ...defaultConfig, embeddings: { model: 'legacy-model', enabled: true } } });
    renderSettingsRoute('/settings/embeddings', adminUser);
    expect(await screen.findAllByText(/Unsupported legacy model: legacy-model/i)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});

describe('Header settings menu placement', () => {
  beforeEach(() => {
    vectorStatusMock.mockClear();
  });

  it('renders Settings above Sign out in profile menu', async () => {
    renderHeader(adminUser);
    fireEvent.click(await screen.findByRole('button', { name: /admin/i }));
    const settings = await screen.findByRole('button', { name: /settings/i });
    const signOut = await screen.findByRole('button', { name: /sign out/i });
    const buttons = Array.from(settings.parentElement?.children ?? []).filter(
      (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
    );
    const labels = buttons.map((button) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    const settingsIndex = labels.findIndex((label) => label.includes('Settings'));
    const signOutIndex = labels.findIndex((label) => label.includes('Sign out'));
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeLessThan(signOutIndex);
    expect(signOut).toBeInTheDocument();
  });
});
