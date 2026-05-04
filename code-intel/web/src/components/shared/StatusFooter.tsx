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

  const [wsConnected, setWsConnected] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
  };

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  // WebSocket live-update
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
            reconnectTimer = setTimeout(connect, 3000 + Math.random() * 500);
          }
        };
        ws.onerror = () => { /* onclose fires next */ };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as { type: string; changedFiles?: string[] };
            if (msg.type === 'graph:updated') {
              const n = msg.changedFiles?.length ?? 0;
              showToast(`Graph updated — ${n} file${n !== 1 ? 's' : ''} changed`);
            }
          } catch { /* ignore */ }
        };
      } catch { /* WebSocket unavailable */ }
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      setWsConnected(false);
    };
  }, [state.connected, state.currentUser, state.serverUrl]);

  // Vector index polling
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected, state.serverUrl]);

  const dotColor = !state.connected ? 'bg-text-muted' : 'bg-node-function';

  let vecBadge: React.ReactNode;
  if (vecState === 'building') {
    vecBadge = (
      <span className="flex items-center gap-1 text-amber-400">
        <span className="inline-block" style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}>⟳</span>
        <span>vec building…</span>
      </span>
    );
  } else if (vecState === 'ready') {
    vecBadge = <span className="text-node-function">⚡ vec ready</span>;
  } else {
    vecBadge = <span className="text-text-muted/50">vec –</span>;
  }

  const selectedNode: CodeNode | null = state.selectedNode;

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Graph-updated toast */}
      {toastMsg && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-accent/90 border border-accent/50 text-white text-xs px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 pointer-events-none animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-white/60 animate-pulse" />
          {toastMsg}
        </div>
      )}

      <footer className="h-7 bg-deep border-t border-border-subtle flex items-center px-3 text-xs text-text-muted shrink-0">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            <span className={state.connected ? 'text-text-secondary' : 'text-text-muted/60'}>
              {state.connected ? state.serverUrl : 'Disconnected'}
            </span>
          </span>

          {state.connected && (
            <>
              <span className="text-border-default">·</span>
              <span
                className="flex items-center gap-1"
                title={wsConnected ? 'Live updates active' : 'Live updates disconnected'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-node-function' : 'bg-text-muted/40'}`} />
                <span className={wsConnected ? 'text-node-function' : 'text-text-muted/40'}>live</span>
              </span>
            </>
          )}

          <span className="text-border-default">·</span>
          {vecBadge}

          {state.nodes.length > 0 && (
            <>
              <span className="text-border-default">·</span>
              <span>
                {state.nodes.length.toLocaleString()} nodes
                &thinsp;/&thinsp;
                {state.edges.length.toLocaleString()} edges
              </span>
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Right */}
        {selectedNode && (
          <span
            className="max-w-[30ch] truncate px-2 py-0.5 rounded-full bg-elevated text-text-secondary border border-border-subtle font-mono mr-3"
            title={selectedNode.name}
          >
            {selectedNode.name}
          </span>
        )}
        <span className="font-mono text-text-muted/50 text-[10px] select-none">v{__APP_VERSION__}</span>
      </footer>
    </>
  );
}
