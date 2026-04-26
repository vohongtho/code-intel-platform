import React, { useEffect, useState } from 'react';
import { useAppState } from '../state/app-context';
import { ApiClient } from '../api/client';

export function ConnectPage() {
  const { state, dispatch } = useAppState();

  const defaultUrl =
    window.location.port === '5173' || window.location.port === '5174'
      ? 'http://localhost:4747'
      : window.location.origin;

  const [url, setUrl] = useState(defaultUrl);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Auto-connect on mount
  useEffect(() => {
    handleConnect(defaultUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (connectUrl = url) => {
    setError('');
    setConnecting(true);
    try {
      const client = new ApiClient(connectUrl);
      const repos = await client.listRepos();

      if (repos.length === 0) {
        setError('No indexed repositories found. Run `code-intel analyze` first.');
        setConnecting(false);
        return;
      }

      dispatch({ type: 'SET_SERVER_URL', url: connectUrl });
      dispatch({ type: 'SET_REPO_NAME', name: repos[0].name });
      dispatch({ type: 'SET_VIEW', view: 'loading' });

      const { nodes, edges } = await client.fetchGraph(repos[0].name);
      dispatch({ type: 'SET_GRAPH', nodes, edges });
      dispatch({ type: 'SET_CONNECTED', connected: true });
      dispatch({ type: 'SET_VIEW', view: 'exploring' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#040812]">
      <div className="bg-[#0a0d18] border border-gray-800/60 rounded-2xl shadow-2xl w-full max-w-md p-10">

        {/* Logo + branding */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg mb-4 select-none">
            ◈
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Code Intel</h1>
          <p className="text-gray-400 text-sm mt-1">Knowledge Graph Explorer</p>
        </div>

        <div className="space-y-5">
          {/* URL input */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-widest mb-2">
              Server URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !connecting && handleConnect()}
              disabled={connecting}
              className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 border border-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 placeholder-gray-600 transition disabled:opacity-50"
              placeholder="http://localhost:4747"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg bg-red-950/40 border border-red-800/50 px-4 py-3">
              <svg
                className="w-4 h-4 text-red-400 mt-0.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
              <p className="text-red-400 text-sm leading-snug">{error}</p>
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={() => handleConnect()}
            disabled={connecting}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg py-2.5 font-medium transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/30"
          >
            {connecting ? (
              <>
                <svg
                  className="animate-spin w-4 h-4 text-white/80"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Connecting…
              </>
            ) : (
              'Connect'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
