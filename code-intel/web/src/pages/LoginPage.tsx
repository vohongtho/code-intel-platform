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

  // On mount — check bootstrap status, then check if already authenticated
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
      <div className="flex items-center justify-center min-h-screen bg-[#040812]">
        <div className="flex items-center gap-3 text-gray-400">
          <Spinner className="w-5 h-5 text-cyan-500" />
          <span className="text-sm">Checking session…</span>
        </div>
      </div>
    );
  }

  if (bootstrapMode) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#040812]">
        <div className="bg-[#0a0d18] border border-gray-800/60 rounded-2xl shadow-2xl w-full max-w-sm p-10">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg mb-4 select-none">
              ◈
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Code Intel</h1>
            <p className="text-gray-400 text-sm mt-1">First-time Setup</p>
          </div>

          <div className="mb-4 rounded-lg bg-cyan-950/40 border border-cyan-800/50 px-4 py-3">
            <p className="text-cyan-300 text-sm leading-snug">
              No admin account found. Create one to get started.
            </p>
          </div>

          <form onSubmit={handleBootstrap} className="space-y-4">
            {/* Server URL */}
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
                Server URL
              </label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={loading}
                className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
                placeholder="http://localhost:4747"
                autoComplete="off"
              />
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
                Admin Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoComplete="username"
                className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
                placeholder="admin"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
                placeholder="••••••••"
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
                placeholder="••••••••"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg bg-red-950/40 border border-red-800/50 px-4 py-3">
                <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-red-400 text-sm leading-snug">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <>
                  <Spinner className="w-4 h-4" />
                  Creating account…
                </>
              ) : (
                'Create Admin Account'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#040812]">
      <div className="bg-[#0a0d18] border border-gray-800/60 rounded-2xl shadow-2xl w-full max-w-sm p-10">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg mb-4 select-none">
            ◈
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Code Intel</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Server URL */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
              Server URL
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={loading}
              className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
              placeholder="http://localhost:4747"
              autoComplete="off"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoComplete="username"
              className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
              placeholder="admin"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50 text-sm"
              placeholder="••••••••"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg bg-red-950/40 border border-red-800/50 px-4 py-3">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-red-400 text-sm leading-snug">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {loading ? (
              <>
                <Spinner className="w-4 h-4" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Help text */}
        <div className="mt-6 pt-5 border-t border-gray-800/60">
          <p className="text-center text-xs text-gray-600">
            No account?{' '}
            <span className="font-mono text-gray-500">code-intel user create admin --role admin</span>
          </p>
          <p className="text-center text-xs text-gray-700 mt-1.5">
            Or use a Bearer token via{' '}
            <span className="font-mono text-gray-600">Authorization: Bearer &lt;token&gt;</span>
          </p>
        </div>
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
