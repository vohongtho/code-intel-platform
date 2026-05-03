import React, { useEffect, useState } from 'react';
import { useAppState } from '../state/app-context';
import { ApiClient } from '../api/client';

export function LoginPage() {
  const { state, dispatch } = useAppState();

  const defaultUrl =
    window.location.port === '5173' || window.location.port === '5174'
      ? 'http://localhost:4747'
      : window.location.origin;

  const [serverUrl, setServerUrl] = useState(defaultUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [bootstrapMode, setBootstrapMode] = useState(false);

  useEffect(() => {
    const client = new ApiClient(state.serverUrl || defaultUrl);
    (async () => {
      try {
        const { needsBootstrap } = await client.bootstrapStatus();
        if (needsBootstrap) {
          setBootstrapMode(true);
          setChecking(false);
          return;
        }
        const status = await client.authStatus();
        if (status.authenticated && status.user) {
          dispatch({ type: 'SET_SERVER_URL', url: state.serverUrl || defaultUrl });
          dispatch({ type: 'SET_CURRENT_USER', user: status.user });
          dispatch({ type: 'SET_VIEW', view: 'connect' });
        }
      } catch { /* ignore */ }
      setChecking(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const client = new ApiClient(serverUrl);
      const { user } = await client.login(username.trim(), password);
      dispatch({ type: 'SET_SERVER_URL', url: serverUrl });
      dispatch({ type: 'SET_CURRENT_USER', user });
      dispatch({ type: 'SET_VIEW', view: 'connect' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const client = new ApiClient(serverUrl);
      const { user } = await client.bootstrap(username.trim(), password);
      dispatch({ type: 'SET_SERVER_URL', url: serverUrl });
      dispatch({ type: 'SET_CURRENT_USER', user });
      dispatch({ type: 'SET_VIEW', view: 'connect' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-void">
        <div className="flex items-center gap-3 text-text-muted">
          <Spinner className="w-5 h-5 text-accent" />
          <span className="text-sm">Checking session…</span>
        </div>
      </div>
    );
  }

  const inputClass =
    'w-full bg-elevated text-text-primary rounded-lg px-4 py-2.5 border border-border-default focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 placeholder-text-muted transition disabled:opacity-50 text-sm';
  const labelClass = 'block text-xs font-medium text-text-secondary uppercase tracking-widest mb-1.5';

  if (bootstrapMode) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-void">
        <div className="bg-deep border border-border-subtle rounded-2xl shadow-2xl w-full max-w-sm p-10">
          <Logo subtitle="First-time Setup" />

          <div className="mb-4 rounded-lg bg-accent/10 border border-accent/30 px-4 py-3">
            <p className="text-text-secondary text-sm leading-snug">
              No admin account found. Create one to get started.
            </p>
          </div>

          <form onSubmit={handleBootstrap} className="space-y-4">
            <Field label="Server URL" labelClass={labelClass}>
              <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
                disabled={loading} className={inputClass} placeholder="http://localhost:4747" autoComplete="off" />
            </Field>
            <Field label="Admin Username" labelClass={labelClass}>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                disabled={loading} autoComplete="username" className={inputClass} placeholder="admin" />
            </Field>
            <Field label="Password" labelClass={labelClass}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                disabled={loading} autoComplete="new-password" className={inputClass} placeholder="••••••••" />
            </Field>
            <Field label="Confirm Password" labelClass={labelClass}>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading} autoComplete="new-password" className={inputClass} placeholder="••••••••" />
            </Field>

            {error && <ErrorBanner message={error} />}

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-accent to-accent-dim hover:opacity-90 text-white font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2 shadow-glow">
              {loading ? <><Spinner className="w-4 h-4" /> Creating account…</> : 'Create Admin Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-void">
      <div className="bg-deep border border-border-subtle rounded-2xl shadow-2xl w-full max-w-sm p-10">
        <Logo subtitle="Sign in to your account" />

        <form onSubmit={handleLogin} className="space-y-4">
          <Field label="Server URL" labelClass={labelClass}>
            <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
              disabled={loading} className={inputClass} placeholder="http://localhost:4747" autoComplete="off" />
          </Field>
          <Field label="Username" labelClass={labelClass}>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              disabled={loading} autoComplete="username" className={inputClass} placeholder="admin" />
          </Field>
          <Field label="Password" labelClass={labelClass}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              disabled={loading} autoComplete="current-password" className={inputClass} placeholder="••••••••" />
          </Field>

          {error && <ErrorBanner message={error} />}

          <button type="submit" disabled={loading}
            className="w-full bg-gradient-to-r from-accent to-accent-dim hover:opacity-90 text-white font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2 shadow-glow">
            {loading ? <><Spinner className="w-4 h-4" /> Signing in…</> : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-border-subtle">
          <p className="text-center text-xs text-text-muted">
            No account?{' '}
            <span className="font-mono text-text-secondary">code-intel user create admin --role admin</span>
          </p>
          <p className="text-center text-xs text-text-muted/60 mt-1.5">
            Or use a Bearer token via{' '}
            <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Logo({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col items-center mb-8">
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center text-white text-3xl font-bold shadow-glow mb-4 select-none">
        ◈
      </div>
      <h1 className="text-2xl font-bold text-text-primary tracking-tight">Code Intel</h1>
      <p className="text-text-muted text-sm mt-1">{subtitle}</p>
      <span className="mt-1.5 text-[10px] font-mono text-text-muted/50 select-none">v{__APP_VERSION__}</span>
    </div>
  );
}

function Field({ label, labelClass, children }: { label: string; labelClass: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-red-950/40 border border-red-800/50 px-4 py-3">
      <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <p className="text-red-400 text-sm leading-snug">{message}</p>
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
