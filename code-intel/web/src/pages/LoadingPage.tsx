import React from 'react';

export function LoadingPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#040812]">
      <div className="flex flex-col items-center gap-6">

        {/* Pulsing logo */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulse ring */}
          <span className="absolute inline-flex h-16 w-16 rounded-xl bg-cyan-500/20 animate-ping" />
          <div className="relative w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-3xl font-bold shadow-xl shadow-cyan-900/40 select-none">
            ◈
          </div>
        </div>

        {/* Primary label */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-gray-300 text-lg font-medium tracking-wide">
            Building knowledge graph…
          </p>

          {/* Animated dots */}
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce" />
          </div>
        </div>

        {/* Subtle tagline */}
        <p className="text-gray-600 text-sm tracking-widest uppercase">
          Indexing nodes and edges…
        </p>
      </div>
    </div>
  );
}
