import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeNode } from '@code-intel/shared';
import { ApiClient } from '../../api/client';
import { useAppState } from '../../state/app-context';

type VecState = 'unknown' | 'building' | 'ready';

export function StatusFooter() {
  const { state } = useAppState();
  const [vecState, setVecState] = useState<VecState>('unknown');
  const [spin, setSpin] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollVectorStatus = useCallback(async () => {
    if (!state.connected) return;

    const client = new ApiClient(state.serverUrl);
    try {
      const status = await client.vectorStatus();
      if (status.ready) {
        setVecState('ready');
        setSpin(false);
        // Stop polling once ready
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }
      if (status.building) {
        setVecState('building');
        setSpin(true);
      } else {
        setVecState('unknown');
        setSpin(false);
      }
    } catch {
      setVecState('unknown');
      setSpin(false);
    }

    // Schedule next poll only while still building / unknown
    timerRef.current = setTimeout(() => void pollVectorStatus(), 5_000);
  }, [state.connected, state.serverUrl]);

  // Kick off polling whenever connectivity/server changes
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVecState('unknown');
    setSpin(false);

    if (state.connected) {
      void pollVectorStatus();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.connected, state.serverUrl]); // intentionally omit pollVectorStatus to avoid loop

  /* ── connection dot ── */
  const dotColor = !state.connected
    ? 'bg-gray-500'
    : 'bg-green-500';

  /* ── vector badge ── */
  let vecBadge: React.ReactNode;
  if (vecState === 'building') {
    vecBadge = (
      <span className="flex items-center gap-1 text-yellow-400">
        <span
          className="inline-block"
          style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}
        >
          ⟳
        </span>
        <span>vec building…</span>
      </span>
    );
  } else if (vecState === 'ready') {
    vecBadge = <span className="text-green-400">⚡ vec ready</span>;
  } else {
    vecBadge = <span className="text-gray-600">vec –</span>;
  }

  /* ── selected node pill ── */
  const selectedNode: CodeNode | null = state.selectedNode;

  return (
    <>
      {/* Keyframe for the spinning ⟳ — inlined so it works without a CSS file */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

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

          {/* Separator */}
          <span className="text-gray-700">·</span>

          {/* Vector index state */}
          {vecBadge}

          {/* Node / edge counts — only when graph is loaded */}
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

        {/* Right section — selected node pill */}
        {selectedNode && (
          <span
            className="
              max-w-[30ch] truncate
              px-2 py-0.5 rounded-full
              bg-gray-800 text-gray-300
              border border-gray-700
              font-mono
            "
            title={selectedNode.name}
          >
            {selectedNode.name}
          </span>
        )}
      </div>
    </>
  );
}
