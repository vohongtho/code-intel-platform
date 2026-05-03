import React, { useEffect, useRef } from 'react';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Esc'],      description: 'Close panel / Deselect node' },
      { keys: ['Tab'],      description: 'Cycle through NodeDetail tabs' },
      { keys: ['←', '→'],  description: 'Navigate search results' },
    ],
  },
  {
    title: 'Search',
    shortcuts: [
      { keys: ['⌘K', 'Ctrl+K'], description: 'Focus search' },
      { keys: ['?'],             description: 'Toggle shortcuts panel' },
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

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm bg-deep border border-border-subtle rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary tracking-wide">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition text-base leading-none"
            aria-label="Close shortcuts panel"
          >
            ×
          </button>
        </div>

        {/* Groups */}
        <div className="p-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-[10px] font-bold tracking-widest text-accent/70 uppercase mb-2">
                {group.title}
              </p>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {shortcut.keys.map((key) => (
                        <span
                          key={key}
                          className="bg-elevated border border-border-default text-text-secondary font-mono text-xs rounded px-1.5 py-0.5"
                        >
                          {key}
                        </span>
                      ))}
                    </div>
                    <span className="text-text-muted text-xs text-right">
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
