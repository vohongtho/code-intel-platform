import React from 'react';
import { useAppState } from '../state/app-context';

export function LoadingPage() {
  const { state } = useAppState();
  const progress = state.graphLoad;

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-void">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm px-8">

        {/* Pulsing logo */}
        <div className="relative flex items-center justify-center">
          <span className="absolute inline-flex h-20 w-20 rounded-2xl bg-accent/20 animate-ping" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center text-white text-3xl font-bold shadow-glow select-none">
            ◈
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-text-primary text-lg font-semibold tracking-tight">
            {progress?.phase === 'edges'
              ? 'Fetching graph structure…'
              : progress
              ? 'Loading nodes…'
              : 'Building knowledge graph…'}
          </p>
          {progress?.phase === 'nodes' && progress.total > 0 ? (
            <p className="text-text-muted text-sm font-mono tabular-nums">
              {progress.loaded.toLocaleString()} / {progress.total.toLocaleString()} nodes
            </p>
          ) : (
            <p className="text-text-muted text-sm">
              {state.repoName || 'Preparing…'}
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full">
          <div className="h-1.5 w-full bg-elevated rounded-full overflow-hidden border border-border-subtle">
            {pct !== null ? (
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-accent-dim transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            ) : (
              // Indeterminate shimmer when we don't have a total yet
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-dim animate-[shimmer_1.5s_ease-in-out_infinite]"
                style={{ width: '40%', animation: 'shimmer 1.5s ease-in-out infinite' }}
              />
            )}
          </div>
          {pct !== null && (
            <div className="flex justify-between mt-1.5 text-[10px] text-text-muted font-mono">
              <span>{pct}%</span>
              <span>{progress!.total.toLocaleString()} total</span>
            </div>
          )}
        </div>

        {/* Dots */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" />
        </div>

      </div>

      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
