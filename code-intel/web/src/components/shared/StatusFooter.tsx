import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeNode } from 'code-intel-shared';
import { ApiClient } from '../../api/client';
import { useAppState } from '../../state/app-context';

type VecState = 'unknown' | 'building' | 'ready';

export function StatusFooter() {
  const { state } = useAppState();
  const [vecState, setVecState] = useState<VecState>('unknown');
  const [spin, setSpin] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── WebSocket live-update indicator + toast ───────────────────────────────
  const [wsConnected, setWsConnected] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
  };

  // Clear toast timer on unmount to avoid state updates on unmounted component
  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!state.connected || !state.currentUser) return;

    const wsUrl = state.serverUrl.replace(/^http/, 'ws') + '/ws';
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          if (!destroyed) {
            const jitter = Math.random() * 500;
            reconnectTimer = setTimeout(connect, 3000 + jitter);
          }
        };
        ws.onerror = () => { /* onclose will fire next */ };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as {
              type: string;
              changedFiles?: string[];
            };
            if (msg.type === 'graph:updated') {
              const n = msg.changedFiles?.length ?? 0;
              showToast(`Graph updated — ${n} file${n !== 1 ? 's' : ''} changed`);
            }
          } catch { /* ignore malformed messages */ }
        };
      } catch { /* WebSocket not available in this env */ }
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      setWsConnected(false);
    };
  }, [state.connected, state.currentUser, state.serverUrl]);

  // ── Vector index polling ──────────────────────────────────────────────────
  const pollVectorStatus = useCallback(async () => {
    if (!state.connected) return;
    const client = new ApiClient(state.serverUrl);
    try {
      const status = await client.vectorStatus();
      if (status.ready) {
        setVecState('ready');
        setSpin(false);
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }
      if (status.building) { setVecState('building'); setSpin(true); }
      else { setVecState('unknown'); setSpin(false); }
    } catch {
      setVecState('unknown');
      setSpin(false);
    }
    timerRef.current = setTimeout(() => void pollVectorStatus(), 5_000);
  }, [state.connected, state.serverUrl]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVecState('unknown');
    setSpin(false);
    if (state.connected) void pollVectorStatus();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [state.connected, state.serverUrl]); // intentionally omit pollVectorStatus

  /* ── connection dot ── */
  const dotColor = !state.connected ? 'bg-gray-500' : 'bg-green-500';

  /* ── vector badge ── */
  let vecBadge: React.ReactNode;
  if (vecState === 'building') {
    vecBadge = (
      <span className="flex items-center gap-1 text-yellow-400">
        <span className="inline-block" style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}>⟳</span>
        <span>vec building…</span>
      </span>
    );
  } else if (vecState === 'ready') {
    vecBadge = <span className="text-green-400">⚡ vec ready</span>;
  } else {
    vecBadge = <span className="text-gray-600">vec –</span>;
  }

  const selectedNode: CodeNode | null = state.selectedNode;

  return (
    <>
      {/* Keyframe for the spinning ⟳ */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Graph-updated toast */}
      {toastMsg && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-cyan-900/90 border border-cyan-500/50 text-cyan-200 text-xs px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          {toastMsg}
        </div>
      )}

      <div className="h-7 bg-[#050810] border-t border-gray-800 flex items-center px-3 text-xs text-gray-500 shrink-0">
        {/* Left section */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Connection dot + label */}
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            <span className={state.connected ? 'text-gray-400' : 'text-gray-600'}>
              {state.connected ? state.serverUrl : 'Disconnected'}
            </span>
          </span>

          {/* Live WebSocket indicator */}
          {state.connected && (
            <>
              <span className="text-gray-700">·</span>
              <span
                className="flex items-center gap-1"
                title={wsConnected ? 'Live updates active' : 'Live updates disconnected'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-gray-600'}`} />
                <span className={wsConnected ? 'text-green-400' : 'text-gray-600'}>live</span>
              </span>
            </>
          )}

          {/* Separator */}
          <span className="text-gray-700">·</span>

          {/* Vector index state */}
          {vecBadge}

          {/* Node / edge counts */}
          {state.nodes.length > 0 && (
            <>
              <span className="text-gray-700">·</span>
              <span className="text-gray-500">
                {state.nodes.length.toLocaleString()} nodes
                &thinsp;/&thinsp;
                {state.edges.length.toLocaleString()} edges
              </span>
            </>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right section — selected node pill + version */}
        {selectedNode && (
          <span
            className="max-w-[30ch] truncate px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700 font-mono mr-3"
            title={selectedNode.name}
          >
            {selectedNode.name}
          </span>
        )}
        <span className="font-mono text-gray-700 text-[10px] select-none">v{__APP_VERSION__}</span>
      </div>
    </>
  );
}
