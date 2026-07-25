import React, { useEffect } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { useAppState } from '../state/app-context';
import { Header } from '../components/shared/Header';
import { ApiClient, type ConfigValidationError } from '../api/client';
import type { AppConfig } from '../state/types';
import { SETTINGS_SECTIONS, getSettingsPath, isSettingsSection, type SettingsSection } from '../routing';

const SECTION_LABEL = 'rounded-xl border border-border-subtle bg-surface p-5 space-y-4';
const CONTROL_HEIGHT = 'h-10';
const INPUT = `w-full ${CONTROL_HEIGHT} bg-elevated text-text-primary rounded-lg px-3 py-2 border border-border-default focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 placeholder-text-muted transition text-sm`;
const LABEL = 'block text-xs font-medium text-text-secondary uppercase tracking-widest mb-1.5';

const DEFAULT_CONFIG: AppConfig = {
  llm: { provider: 'ollama', model: 'llama3', apiKey: '', baseUrl: '', batchSize: 20, maxTokensPerSummary: 100 },
  embeddings: { model: 'all-MiniLM-L6-v2', enabled: false },
  analysis: { maxFileSizeKB: 512, ignorePatterns: [], incrementalByDefault: false },
  serve: { defaultPort: 4747, openBrowser: true },
  auth: { mode: 'local' },
  updates: { checkOnStartup: true, intervalHours: 24 },
  telemetry: { enabled: false },
};

export function SettingsPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const params = useParams<{ section?: string }>();
  const activeSection: SettingsSection = isSettingsSection(params.section ?? '') ? params.section as SettingsSection : 'overview';

  useEffect(() => {
    if (!params.section) {
      navigate(getSettingsPath('overview'), { replace: true });
      return;
    }
    if (!isSettingsSection(params.section)) {
      navigate(getSettingsPath('overview'), { replace: true });
      return;
    }
  }, [navigate, params.section]);

  useEffect(() => {
    if (state.config.current || state.config.loading) return;
    const load = async () => {
      dispatch({ type: 'SET_CONFIG_LOADING', loading: true });
      dispatch({ type: 'SET_CONFIG_ERROR', error: null });
      try {
        const client = new ApiClient(state.serverUrl);
        const { config } = await client.getConfig();
        dispatch({ type: 'SET_CONFIG', config });
      } catch (err) {
        dispatch({ type: 'SET_CONFIG_ERROR', error: err instanceof Error ? err.message : 'Failed to load config' });
        dispatch({ type: 'SET_CONFIG', config: DEFAULT_CONFIG });
      } finally {
        dispatch({ type: 'SET_CONFIG_LOADING', loading: false });
      }
    };
    void load();
  }, [dispatch, state.config.current, state.config.loading, state.serverUrl]);

  const config = state.config.current ?? DEFAULT_CONFIG;
  const canEdit = state.currentUser?.role === 'admin';

  const updateConfig = (next: AppConfig) => {
    dispatch({ type: 'UPDATE_CONFIG', config: next });
    dispatch({ type: 'SET_CONFIG_VALIDATION_ERRORS', errors: [] });
    dispatch({ type: 'SET_CONFIG_ERROR', error: null });
  };

  const save = async () => {
    if (!canEdit) return;
    dispatch({ type: 'SET_CONFIG_SAVING', saving: true });
    dispatch({ type: 'SET_CONFIG_ERROR', error: null });
    dispatch({ type: 'SET_CONFIG_VALIDATION_ERRORS', errors: [] });
    try {
      const client = new ApiClient(state.serverUrl);
      const { config: saved } = await client.saveConfig(config);
      dispatch({ type: 'SET_CONFIG', config: saved });
    } catch (err) {
      const error = err as Error & { validationErrors?: ConfigValidationError[] };
      dispatch({ type: 'SET_CONFIG_ERROR', error: error.message });
      dispatch({ type: 'SET_CONFIG_VALIDATION_ERRORS', errors: error.validationErrors ?? [] });
    } finally {
      dispatch({ type: 'SET_CONFIG_SAVING', saving: false });
    }
  };

  const renderErrors = () => {
    if (!state.config.validationErrors.length) return null;
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
        <p className="font-semibold mb-2">Validation errors</p>
        <ul className="space-y-1 list-disc list-inside">
          {state.config.validationErrors.map((error) => (
            <li key={`${error.path}:${error.reason}`}>{error.path}: {error.reason}</li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="flex flex-col min-h-screen bg-void text-text-primary">
      <Header onToggleAI={() => {}} aiOpen={false} />
      <main className="max-w-6xl mx-auto w-full px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate(state.connected ? '/explore' : '/connect')}
              className="text-sm text-text-muted hover:text-text-primary transition mb-3"
            >
              ← Back
            </button>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-text-secondary mt-2 max-w-3xl">
              Global server configuration. Stored on this code-intel instance. Applies to all repos on this server.
            </p>
          </div>
          <div className="text-right text-sm text-text-muted">
            <p>Role: <span className="text-text-primary">{state.currentUser?.role ?? 'unknown'}</span></p>
            <p>{canEdit ? 'Admin can edit settings.' : 'Read-only for this role.'}</p>
          </div>
        </div>

        {state.config.error && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {state.config.error}
          </div>
        )}
        {renderErrors()}

        {state.config.loading ? (
          <div className="rounded-xl border border-border-subtle bg-surface p-8 text-text-muted">Loading settings…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-6">
            <aside className="rounded-xl border border-border-subtle bg-deep p-4 h-fit sticky top-6">
              <nav className="space-y-2 text-sm">
                {SETTINGS_SECTIONS.map((section) => {
                  const label = section === 'llm'
                    ? 'LLM'
                    : section.charAt(0).toUpperCase() + section.slice(1);
                  return (
                    <NavLink
                      key={section}
                      to={getSettingsPath(section)}
                      className={({ isActive }) => `block rounded-lg px-3 py-2 transition ${isActive ? 'bg-accent/10 text-accent border border-accent/20' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
                    >
                      {label}
                    </NavLink>
                  );
                })}
              </nav>
            </aside>

            <div className="space-y-6">
              {activeSection === 'overview' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Overview</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Stat label="Provider" value={config.llm.provider} />
                  <Stat label="Model" value={config.llm.model} />
                  <Stat label="Auth mode" value={config.auth.mode} />
                  <Stat label="Port" value={String(config.serve.defaultPort)} />
                </div>
              </section>}

              {activeSection === 'llm' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">LLM</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Provider"><select disabled={!canEdit} value={config.llm.provider} onChange={(e) => updateConfig({ ...config, llm: { ...config.llm, provider: e.target.value as AppConfig['llm']['provider'] } })} className={INPUT}><option value="openai">openai</option><option value="anthropic">anthropic</option><option value="ollama">ollama</option><option value="custom">custom</option><option value="none">none</option></select></Field>
                  <Field label="Model"><input disabled={!canEdit} className={INPUT} value={config.llm.model} onChange={(e) => updateConfig({ ...config, llm: { ...config.llm, model: e.target.value } })} /></Field>
                  <Field label="API key"><input disabled={!canEdit} className={INPUT} value={config.llm.apiKey} onChange={(e) => updateConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } })} placeholder="$OPENAI_API_KEY or ***" /></Field>
                  <Field label="Base URL"><input disabled={!canEdit} className={INPUT} value={config.llm.baseUrl ?? ''} onChange={(e) => updateConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } })} /></Field>
                  <Field label="Batch size"><input disabled={!canEdit} type="number" className={INPUT} value={config.llm.batchSize} onChange={(e) => updateConfig({ ...config, llm: { ...config.llm, batchSize: Number(e.target.value) } })} /></Field>
                  <Field label="Max tokens / summary"><input disabled={!canEdit} type="number" className={INPUT} value={config.llm.maxTokensPerSummary} onChange={(e) => updateConfig({ ...config, llm: { ...config.llm, maxTokensPerSummary: Number(e.target.value) } })} /></Field>
                </div>
              </section>}

              {activeSection === 'embeddings' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Embeddings</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Model"><input disabled={!canEdit} className={INPUT} value={config.embeddings.model} onChange={(e) => updateConfig({ ...config, embeddings: { ...config.embeddings, model: e.target.value } })} /></Field>
                  <Toggle label="Enabled" checked={config.embeddings.enabled} disabled={!canEdit} onChange={(checked) => updateConfig({ ...config, embeddings: { ...config.embeddings, enabled: checked } })} />
                </div>
              </section>}

              {activeSection === 'analysis' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Analysis</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Max file size KB"><input disabled={!canEdit} type="number" className={INPUT} value={config.analysis.maxFileSizeKB} onChange={(e) => updateConfig({ ...config, analysis: { ...config.analysis, maxFileSizeKB: Number(e.target.value) } })} /></Field>
                  <Toggle label="Incremental by default" checked={config.analysis.incrementalByDefault} disabled={!canEdit} onChange={(checked) => updateConfig({ ...config, analysis: { ...config.analysis, incrementalByDefault: checked } })} />
                  <Field label="Ignore patterns"><textarea disabled={!canEdit} className={`${INPUT} min-h-28`} value={config.analysis.ignorePatterns.join('\n')} onChange={(e) => updateConfig({ ...config, analysis: { ...config.analysis, ignorePatterns: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) } })} /></Field>
                </div>
              </section>}

              {activeSection === 'server' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Server</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Default port"><input disabled={!canEdit} type="number" className={INPUT} value={config.serve.defaultPort} onChange={(e) => updateConfig({ ...config, serve: { ...config.serve, defaultPort: Number(e.target.value) } })} /></Field>
                  <Toggle label="Open browser" checked={config.serve.openBrowser} disabled={!canEdit} onChange={(checked) => updateConfig({ ...config, serve: { ...config.serve, openBrowser: checked } })} />
                </div>
              </section>}

              {activeSection === 'authentication' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Authentication</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <Field label="Mode"><select disabled={!canEdit} value={config.auth.mode} onChange={(e) => updateConfig({ ...config, auth: { ...config.auth, mode: e.target.value as 'local' | 'oidc', oidc: e.target.value === 'oidc' ? (config.auth.oidc ?? { issuerUrl: '', clientId: '', clientSecret: '' }) : undefined } })} className={INPUT}><option value="local">local</option><option value="oidc">oidc</option></select></Field>
                  {config.auth.mode === 'oidc' && (
                    <>
                      <Field label="Issuer URL"><input disabled={!canEdit} className={INPUT} value={config.auth.oidc?.issuerUrl ?? ''} onChange={(e) => updateConfig({ ...config, auth: { ...config.auth, oidc: { issuerUrl: e.target.value, clientId: config.auth.oidc?.clientId ?? '', clientSecret: config.auth.oidc?.clientSecret ?? '' } } })} /></Field>
                      <Field label="Client ID"><input disabled={!canEdit} className={INPUT} value={config.auth.oidc?.clientId ?? ''} onChange={(e) => updateConfig({ ...config, auth: { ...config.auth, oidc: { issuerUrl: config.auth.oidc?.issuerUrl ?? '', clientId: e.target.value, clientSecret: config.auth.oidc?.clientSecret ?? '' } } })} /></Field>
                      <Field label="Client Secret"><input disabled={!canEdit} className={INPUT} value={config.auth.oidc?.clientSecret ?? ''} onChange={(e) => updateConfig({ ...config, auth: { ...config.auth, oidc: { issuerUrl: config.auth.oidc?.issuerUrl ?? '', clientId: config.auth.oidc?.clientId ?? '', clientSecret: e.target.value } } })} placeholder="$OIDC_CLIENT_SECRET or ***" /></Field>
                    </>
                  )}
                </div>
              </section>}

              {activeSection === 'updates' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Updates</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <Toggle label="Check on startup" checked={config.updates.checkOnStartup} disabled={!canEdit} onChange={(checked) => updateConfig({ ...config, updates: { ...config.updates, checkOnStartup: checked } })} />
                  <Field label="Interval hours"><input disabled={!canEdit} type="number" className={INPUT} value={config.updates.intervalHours} onChange={(e) => updateConfig({ ...config, updates: { ...config.updates, intervalHours: Number(e.target.value) } })} /></Field>
                </div>
              </section>}

              {activeSection === 'telemetry' && <section className={SECTION_LABEL}>
                <h2 className="text-xl font-semibold">Telemetry</h2>
                <Toggle label="Enabled" checked={config.telemetry.enabled} disabled={!canEdit} onChange={(checked) => updateConfig({ ...config, telemetry: { enabled: checked } })} />
              </section>}

              <div className="flex items-center justify-end gap-3 pb-10">
                <button onClick={() => dispatch({ type: 'RESET_CONFIG_EDITS' })} className="px-4 py-2 rounded-lg border border-border-default text-text-secondary hover:text-text-primary hover:bg-hover transition" disabled={state.config.saving}>Cancel</button>
                <button onClick={save} disabled={!canEdit || state.config.saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-accent to-accent-dim text-white font-semibold shadow-glow disabled:opacity-50">
                  {state.config.saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className={LABEL}>{label}</span>{children}</label>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <div className={`flex ${CONTROL_HEIGHT} items-center justify-end rounded-lg border border-border-subtle bg-elevated px-3`}>
        <button type="button" aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? 'bg-accent' : 'bg-border-default'} disabled:opacity-50`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text-primary mt-1 break-all">{value}</p>
    </div>
  );
}
