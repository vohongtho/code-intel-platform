import React, { useEffect, useRef } from 'react';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Esc'], description: 'Close panel / Deselect node' },
      { keys: ['Tab'], description: 'Cycle through NodeDetail tabs' },
      { keys: ['←', '→'], description: 'Navigate search results' },
    ],
  },
  {
    title: 'Search',
    shortcuts: [
      { keys: ['⌘K', 'Ctrl+K'], description: 'Focus search' },
      { keys: ['?'], description: 'Toggle shortcuts panel' },
    ],
  },
  {
    title: 'Graph',
    shortcuts: [
      { keys: ['F'], description: 'Fit graph to view' },
      { keys: ['G'], description: 'Jump to graph' },
    ],
  },
];

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm bg-[#0c0f1e] border border-gray-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-gray-100 tracking-wide">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition text-base leading-none"
            aria-label="Close shortcuts panel"
          >
            ×
          </button>
        </div>

        {/* Groups */}
        <div className="p-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-[10px] font-bold tracking-widest text-cyan-500/70 uppercase mb-2">
                {group.title}
              </p>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4"
                  >
                    {/* Key pills */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {shortcut.keys.map((key) => (
                        <span
                          key={key}
                          className="bg-gray-800 border border-gray-700 text-gray-300 font-mono text-xs rounded px-1.5 py-0.5"
                        >
                          {key}
                        </span>
                      ))}
                    </div>
                    {/* Description */}
                    <span className="text-gray-400 text-xs text-right">
                      {shortcut.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
