import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ApiClient } from '../../api/client';
import { useAppState } from '../../state/app-context';

// ── highlight.js dynamic import (graceful degradation) ───────────────────────
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

// ── Storage key ───────────────────────────────────────────────────────────────
const PANEL_SIZE_KEY = 'code-intel:source-panel-size';
const DEFAULT_PANEL_HEIGHT = 420;

// ── Types ─────────────────────────────────────────────────────────────────────
interface SourcePanelProps {
  file: string;
  startLine: number;
  endLine: number;
  onClose: () => void;
}

interface SourceData {
  content: string;
  language: string;
  startLine: number;
  endLine: number;
}

// ── SourcePanel ───────────────────────────────────────────────────────────────
export function SourcePanel({ file, startLine, endLine, onClose }: SourcePanelProps) {
  const { state } = useAppState();
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Panel height (resizable, persisted) ─────────────────────────────────────
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
      const newHeight = Math.max(180, Math.min(800, dragStartHeight.current + delta));
      setPanelHeight(newHeight);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      try {
        localStorage.setItem(PANEL_SIZE_KEY, String(panelHeight));
      } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [panelHeight]);

  // ── Fetch source ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setHighlighted(null);
    setError(null);
    setLoading(true);

    const client = new ApiClient(state.serverUrl);
    client
      .sourcePreview(file, startLine, endLine)
      .then(async (result) => {
        if (cancelled) return;
        setData(result);

        // Apply syntax highlighting
        const hljsLib = await loadHighlightJs();
        if (cancelled) return;
        if (hljsLib) {
          try {
            const lang = hljsLib.getLanguage(result.language) ? result.language : 'plaintext';
            const highlighted = hljsLib.highlight(result.content, { language: lang });
            setHighlighted(highlighted.value);
          } catch {
            setHighlighted(null);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load source');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [file, startLine, endLine, state.serverUrl]);

  // ── Copy path to clipboard ───────────────────────────────────────────────────
  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${file}:${startLine}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore clipboard errors */ }
  }, [file, startLine]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const shortFile = file.split('/').slice(-3).join('/');

  return (
    <div
      className="bg-[#080b14] border-t border-gray-800 flex flex-col overflow-hidden shadow-2xl"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize bg-gray-800 hover:bg-cyan-500/50 transition-colors flex-shrink-0"
        onMouseDown={onMouseDownResize}
        title="Drag to resize"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/80 bg-[#0a0d18] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold tracking-wider text-cyan-500/80 uppercase">Source</span>
          <span className="text-xs text-gray-400 font-mono truncate" title={file}>{shortFile}</span>
          {(data || loading) && (
            <span className="text-[10px] text-gray-600 font-mono">
              :{startLine}
              {endLine !== startLine ? `–${endLine}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Open in VS Code */}
          <a
            href={`vscode://file/${file}:${startLine}`}
            className="text-[10px] text-gray-400 hover:text-white border border-gray-700/50 hover:border-gray-500 rounded px-2 py-0.5 transition font-mono"
            title="Open in VS Code"
          >
            ⎈ VS Code
          </a>

          {/* Copy path */}
          <button
            onClick={handleCopyPath}
            className={`text-[10px] border rounded px-2 py-0.5 transition font-mono ${
              copied
                ? 'text-green-400 border-green-700/50 bg-green-900/20'
                : 'text-gray-400 hover:text-white border-gray-700/50 hover:border-gray-500'
            }`}
            title={`Copy ${file}:${startLine} to clipboard`}
          >
            {copied ? '✓ copied' : '⎘ copy'}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white text-lg px-2 transition leading-none ml-1"
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
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
          <SourceView
            data={data}
            highlightedHtml={highlighted}
            focusStartLine={startLine}
            focusEndLine={endLine}
          />
        )}
      </div>
    </div>
  );
}

// ── SkeletonLoader ────────────────────────────────────────────────────────────
function SkeletonLoader() {
  return (
    <div className="p-4 space-y-1.5 animate-pulse">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="w-8 h-3 bg-gray-800 rounded flex-shrink-0" />
          <div
            className="h-3 bg-gray-800 rounded"
            style={{ width: `${40 + Math.random() * 50}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ── SourceView ────────────────────────────────────────────────────────────────
interface SourceViewProps {
  data: SourceData;
  highlightedHtml: string | null;
  focusStartLine: number;
  focusEndLine: number;
}

function SourceView({ data, highlightedHtml, focusStartLine, focusEndLine }: SourceViewProps) {
  const lines = data.content.split('\n');
  const highlightedLines = highlightedHtml ? splitHighlightedLines(highlightedHtml) : null;

  return (
    <div className="relative">
      {/* inject hljs styles via a style tag when available */}
      <HljsStyles />
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const lineNum = data.startLine + idx;
            const isFocused = lineNum >= focusStartLine && lineNum <= focusEndLine;
            const htmlLine = highlightedLines ? (highlightedLines[idx] ?? '') : null;

            return (
              <tr
                key={lineNum}
                className={isFocused ? 'bg-amber-900/30' : 'hover:bg-gray-800/30'}
              >
                {/* Line number gutter */}
                <td
                  className={`select-none w-10 text-right pr-3 pl-2 py-0.5 border-r text-[10px] align-top flex-shrink-0 ${
                    isFocused
                      ? 'text-amber-400 border-amber-700/40 bg-amber-900/20'
                      : 'text-gray-700 border-gray-800/60'
                  }`}
                  style={{ userSelect: 'none', minWidth: '2.5rem' }}
                >
                  {lineNum}
                </td>
                {/* Code cell */}
                <td
                  className="pl-4 pr-4 py-0.5 whitespace-pre align-top leading-5"
                  style={{ color: isFocused && !htmlLine ? '#fbbf24' : undefined }}
                >
                  {htmlLine !== null ? (
                    <span dangerouslySetInnerHTML={{ __html: htmlLine || ' ' }} />
                  ) : (
                    <span className={isFocused ? 'text-amber-200' : 'text-gray-300'}>
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

// ── Helper: split highlighted HTML by newlines (preserving spans across lines)
function splitHighlightedLines(html: string): string[] {
  // Simple split: hljs emits \n for newlines, spans don't cross lines
  return html.split('\n');
}

// ── Inject hljs CSS once ──────────────────────────────────────────────────────
let hljsStyleInjected = false;

function HljsStyles() {
  useEffect(() => {
    if (hljsStyleInjected) return;
    hljsStyleInjected = true;
    // Inline a minimal dark theme to avoid an extra network request
    const style = document.createElement('style');
    style.textContent = `
      /* highlight.js minimal dark theme */
      .hljs { color: #abb2bf; }
      .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-literal, .hljs-type { color: #c678dd; }
      .hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-meta-string { color: #98c379; }
      .hljs-comment, .hljs-quote { color: #5c6370; font-style: italic; }
      .hljs-number, .hljs-bullet, .hljs-link, .hljs-meta { color: #d19a66; }
      .hljs-title, .hljs-class .hljs-title, .hljs-function .hljs-title { color: #61afef; }
      .hljs-attr, .hljs-variable, .hljs-template-variable, .hljs-tag, .hljs-name, .hljs-selector-id,
      .hljs-selector-class, .hljs-regexp, .hljs-deletion { color: #e06c75; }
      .hljs-params { color: #abb2bf; }
      .hljs-emphasis { font-style: italic; }
      .hljs-strong { font-weight: bold; }
    `;
    document.head.appendChild(style);
  }, []);
  return null;
}
