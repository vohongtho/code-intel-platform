import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ApiClient } from '../../api/client';
import { useAppState } from '../../state/app-context';

let hljs: typeof import('highlight.js').default | null = null;

async function loadHighlightJs(): Promise<typeof import('highlight.js').default | null> {
  if (hljs) return hljs;
  try {
    const mod = await import('highlight.js');
    hljs = mod.default;
    return hljs;
  } catch {
    return null;
  }
}

const PANEL_SIZE_KEY = 'code-intel:source-panel-size';
const DEFAULT_PANEL_HEIGHT = 420;

interface SourcePanelProps {
  file: string;
  startLine: number;
  endLine: number;
  repo?: string;
  onClose: () => void;
}

interface SourceData {
  content: string;
  language: string;
  startLine: number;
  endLine: number;
}

export function SourcePanel({ file, startLine, endLine, repo, onClose }: SourcePanelProps) {
  const { state } = useAppState();
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [panelHeight, setPanelHeight] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(PANEL_SIZE_KEY);
      return stored ? parseInt(stored, 10) : DEFAULT_PANEL_HEIGHT;
    } catch {
      return DEFAULT_PANEL_HEIGHT;
    }
  });
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const onMouseDownResize = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY;
      setPanelHeight(Math.max(180, Math.min(800, dragStartHeight.current + delta)));
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      try { localStorage.setItem(PANEL_SIZE_KEY, String(panelHeight)); } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [panelHeight]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setHighlighted(null);
    setError(null);
    setLoading(true);

    const client = new ApiClient(state.serverUrl);
    client
      .sourcePreview(file, startLine, endLine, repo)
      .then(async (result) => {
        if (cancelled) return;
        setData(result);
        const hljsLib = await loadHighlightJs();
        if (cancelled) return;
        if (hljsLib) {
          try {
            const lang = hljsLib.getLanguage(result.language) ? result.language : 'plaintext';
            setHighlighted(hljsLib.highlight(result.content, { language: lang }).value);
          } catch {
            setHighlighted(null);
          }
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load source'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [file, startLine, endLine, state.serverUrl]);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${file}:${startLine}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [file, startLine]);

  const shortFile = file.split('/').slice(-3).join('/');

  return (
    <div
      className="bg-deep border-t border-border-subtle flex flex-col overflow-hidden shadow-2xl shrink-0"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize bg-border-subtle hover:bg-accent/50 transition-colors flex-shrink-0"
        onMouseDown={onMouseDownResize}
        title="Drag to resize"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">Source</span>
          <span className="text-xs text-text-secondary font-mono truncate" title={file}>{shortFile}</span>
          {(data || loading) && (
            <span className="text-[10px] text-text-muted font-mono">
              :{startLine}{endLine !== startLine ? `–${endLine}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <a
            href={`vscode://file/${file}:${startLine}`}
            className="text-[10px] text-text-muted hover:text-text-primary border border-border-subtle hover:border-border-default rounded px-2 py-0.5 transition font-mono"
            title="Open in VS Code"
          >
            ⎈ VS Code
          </a>
          <button
            onClick={handleCopyPath}
            className={`text-[10px] border rounded px-2 py-0.5 transition font-mono ${
              copied
                ? 'text-node-function border-node-function/30 bg-node-function/10'
                : 'text-text-muted hover:text-text-primary border-border-subtle hover:border-border-default'
            }`}
            title={`Copy ${file}:${startLine} to clipboard`}
          >
            {copied ? '✓ copied' : '⎘ copy'}
          </button>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg px-2 transition leading-none ml-1"
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {loading && <SkeletonLoader />}
        {error && (
          <div className="p-4">
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              <span className="text-red-400 text-sm">⚠</span>
              <span className="text-red-300 text-xs">{error}</span>
            </div>
          </div>
        )}
        {data && !loading && (
          <SourceView data={data} highlightedHtml={highlighted} focusStartLine={startLine} focusEndLine={endLine} />
        )}
      </div>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="p-4 space-y-1.5 animate-pulse">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="w-8 h-3 bg-elevated rounded flex-shrink-0" />
          <div className="h-3 bg-elevated rounded" style={{ width: `${40 + Math.random() * 50}%` }} />
        </div>
      ))}
    </div>
  );
}

interface SourceViewProps {
  data: SourceData;
  highlightedHtml: string | null;
  focusStartLine: number;
  focusEndLine: number;
}

function SourceView({ data, highlightedHtml, focusStartLine, focusEndLine }: SourceViewProps) {
  const lines = data.content.split('\n');
  const highlightedLines = highlightedHtml ? highlightedHtml.split('\n') : null;

  return (
    <div className="relative">
      <HljsStyles />
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const lineNum = data.startLine + idx;
            const isFocused = lineNum >= focusStartLine && lineNum <= focusEndLine;
            const htmlLine = highlightedLines ? (highlightedLines[idx] ?? '') : null;

            return (
              <tr key={lineNum} className={isFocused ? 'bg-accent/10' : 'hover:bg-elevated/50'}>
                <td
                  className={`select-none w-10 text-right pr-3 pl-2 py-0.5 border-r text-[10px] align-top flex-shrink-0 ${
                    isFocused
                      ? 'text-accent border-accent/30 bg-accent/15'
                      : 'text-text-muted/40 border-border-subtle'
                  }`}
                  style={{ userSelect: 'none', minWidth: '2.5rem' }}
                >
                  {lineNum}
                </td>
                <td
                  className="pl-4 pr-4 py-0.5 whitespace-pre align-top leading-5"
                  style={{ color: isFocused && !htmlLine ? '#a78bfa' : undefined }}
                >
                  {htmlLine !== null ? (
                    <span dangerouslySetInnerHTML={{ __html: htmlLine || ' ' }} />
                  ) : (
                    <span className={isFocused ? 'text-node-interface' : 'text-text-secondary'}>
                      {line || ' '}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

let hljsStyleInjected = false;

function HljsStyles() {
  useEffect(() => {
    if (hljsStyleInjected) return;
    hljsStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .hljs { color: #e4e4ed; }
      .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-literal, .hljs-type { color: #a78bfa; }
      .hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-meta-string { color: #4ade80; }
      .hljs-comment, .hljs-quote { color: #5a5a70; font-style: italic; }
      .hljs-number, .hljs-bullet, .hljs-link, .hljs-meta { color: #fbbf24; }
      .hljs-title, .hljs-class .hljs-title, .hljs-function .hljs-title { color: #22d3ee; }
      .hljs-attr, .hljs-variable, .hljs-template-variable, .hljs-tag, .hljs-name,
      .hljs-selector-id, .hljs-selector-class, .hljs-regexp, .hljs-deletion { color: #f87171; }
      .hljs-params { color: #e4e4ed; }
      .hljs-emphasis { font-style: italic; }
      .hljs-strong { font-weight: bold; }
    `;
    document.head.appendChild(style);
  }, []);
  return null;
}
