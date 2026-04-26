import React, { useEffect, useRef, useState } from 'react';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';
import { runAgent } from '../../ai/agent';
import type { ChatMessage, ChatCitation, ChatToolCall } from '../../state/types';

const SUGGESTIONS = [
  { label: 'Architecture', items: ['Explain the project architecture', 'What are the main modules?'] },
  { label: 'Search', items: ['Find code about HTTP server', 'Who calls runPipeline'] },
  { label: 'Inspect', items: ['Inspect KnowledgeGraph', 'Impact of textSearch'] },
];

export function SidebarChat() {
  const { state, dispatch } = useAppState();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.chat.messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || state.chat.loading) return;
    setInput('');
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: { role: 'user', content: trimmed, timestamp: Date.now() },
    });
    dispatch({ type: 'SET_CHAT_LOADING', loading: true });
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [],
        citations: [],
      },
    });
    const client = new ApiClient(state.serverUrl);
    const toolCalls: ChatToolCall[] = [];
    try {
      await runAgent(trimmed, client, (ev) => {
        if (ev.type === 'tool-start' && ev.toolCall) {
          toolCalls.push(ev.toolCall);
          dispatch({
            type: 'UPDATE_LAST_CHAT_MESSAGE',
            message: { toolCalls: [...toolCalls] },
          });
        } else if (ev.type === 'tool-end' && ev.toolCall) {
          const idx = toolCalls.findIndex(
            (c) => c.tool === ev.toolCall!.tool && c.status === 'running',
          );
          if (idx >= 0) toolCalls[idx] = ev.toolCall;
          else toolCalls.push(ev.toolCall);
          dispatch({
            type: 'UPDATE_LAST_CHAT_MESSAGE',
            message: { toolCalls: [...toolCalls] },
          });
        } else if (ev.type === 'final') {
          dispatch({
            type: 'UPDATE_LAST_CHAT_MESSAGE',
            message: { content: ev.text ?? '', citations: ev.citations ?? [] },
          });
        }
      });
    } catch (err) {
      dispatch({
        type: 'UPDATE_LAST_CHAT_MESSAGE',
        message: { content: `Error: ${err instanceof Error ? err.message : 'unknown'}` },
      });
    } finally {
      dispatch({ type: 'SET_CHAT_LOADING', loading: false });
    }
  };

  const onCitationClick = (c: ChatCitation) => {
    if (c.nodeId) {
      const node = state.nodes.find((n) => n.id === c.nodeId);
      if (node) {
        dispatch({ type: 'SELECT_NODE', node });
        return;
      }
    }
    // fallback: find node by file path
    const fileNode = state.nodes.find(
      (n) => n.kind === 'file' && n.filePath === c.filePath,
    );
    if (fileNode) dispatch({ type: 'SELECT_NODE', node: fileNode });
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800/50 bg-gray-950/50">
        <div className="flex items-center gap-2">
          <span className="text-purple-400">✦</span>
          <h3 className="text-sm font-semibold text-gray-100">Code AI</h3>
          <span className="text-[10px] bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded-full border border-purple-800/30">
            Grounded
          </span>
        </div>
        <button
          onClick={() => dispatch({ type: 'CLEAR_CHAT' })}
          className="text-[10px] text-gray-600 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800/50 transition"
        >
          Clear
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {state.chat.messages.length === 0 && (
          <div className="mt-4 px-2">
            <p className="text-gray-500 text-xs mb-3 leading-relaxed text-center">
              Ask grounded questions. Every answer cites source files.
            </p>
            <div className="space-y-3">
              {SUGGESTIONS.map(({ label, items }) => (
                <div key={label}>
                  <p className="text-[10px] font-bold tracking-wider text-gray-600 uppercase mb-1 px-1">
                    {label}
                  </p>
                  <div className="space-y-1">
                    {items.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="block w-full text-left px-2.5 py-1.5 text-xs bg-gray-800/40 hover:bg-gray-800/80 text-gray-300 hover:text-white rounded-lg border border-gray-800/50 hover:border-gray-700 transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {state.chat.messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} onCitationClick={onCitationClick} />
        ))}
        {state.chat.loading && (
          <div className="flex items-center gap-2 text-gray-500 text-xs">
            <div className="animate-spin w-3 h-3 border-2 border-gray-700 border-t-purple-400 rounded-full" />
            Thinking…
          </div>
        )}
      </div>

      <div className="p-2 border-t border-gray-800 bg-gray-950">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            disabled={state.chat.loading}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            placeholder="Ask about the codebase…"
          />
          <button
            onClick={() => send(input)}
            disabled={state.chat.loading || !input.trim()}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-40 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessage;
  onCitationClick: (c: ChatCitation) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] bg-blue-600/20 border border-blue-700/40 text-blue-100 rounded-lg px-3 py-1.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-1">
          {message.toolCalls.map((tc, i) => (
            <ToolCallChip key={i} tc={tc} />
          ))}
        </div>
      )}
      {message.content && (
        <div className="bg-gray-800/60 border border-gray-800 rounded-lg p-3 text-sm text-gray-200">
          <RichText text={message.content} onCitationClick={onCitationClick} />
        </div>
      )}
    </div>
  );
}

function ToolCallChip({ tc }: { tc: ChatToolCall }) {
  const colorClass =
    tc.status === 'done'
      ? 'border-green-700/40 text-green-400'
      : tc.status === 'error'
        ? 'border-red-700/40 text-red-400'
        : 'border-gray-700 text-gray-400 animate-pulse';
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded border bg-gray-900/60 text-xs ${colorClass}`}
    >
      <span className="font-mono">⚙</span>
      <span className="font-mono font-medium">{tc.tool}</span>
      <span className="text-gray-500 truncate flex-1">
        {tc.resultSummary ?? Object.values(tc.input).slice(0, 1).join(' ')}
      </span>
      <span className="text-[10px]">
        {tc.status === 'running' ? '…' : tc.status === 'done' ? '✓' : '✗'}
      </span>
    </div>
  );
}

/**
 * Renders markdown-like text with [[file:line-line]] citations as clickable pills.
 */
function RichText({
  text,
  onCitationClick,
}: {
  text: string;
  onCitationClick: (c: ChatCitation) => void;
}) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="leading-relaxed">
          {renderLine(line, onCitationClick)}
        </div>
      ))}
    </>
  );
}

const CITE_RE = /\[\[([^\]]+)\]\]/g;
const HEAD_RE = /^(#{1,4})\s+(.*)$/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const CODE_RE = /`([^`]+)`/g;

function renderLine(
  line: string,
  onCitationClick: (c: ChatCitation) => void,
): React.ReactNode {
  // headings
  const head = line.match(HEAD_RE);
  if (head) {
    const level = head[1].length;
    const txt = head[2];
    const Tag = (`h${Math.min(4, level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5');
    const cls =
      level <= 2
        ? 'text-base font-bold text-white mt-2'
        : level === 3
          ? 'text-sm font-semibold text-gray-100 mt-2'
          : 'text-xs font-semibold text-gray-300 mt-1';
    return <Tag className={cls}>{renderInline(txt, onCitationClick)}</Tag>;
  }
  if (line.startsWith('- ')) {
    return <div className="ml-3">• {renderInline(line.slice(2), onCitationClick)}</div>;
  }
  if (line.trim() === '') return <div className="h-1" />;
  return <span>{renderInline(line, onCitationClick)}</span>;
}

function renderInline(
  text: string,
  onCitationClick: (c: ChatCitation) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > lastIdx)
      parts.push(<React.Fragment key={`t-${lastIdx}`}>{formatRich(text.slice(lastIdx, m.index))}</React.Fragment>);
    const raw = m[1];
    const cite = parseCitation(raw);
    parts.push(
      <button
        key={`c-${m.index}`}
        onClick={() => onCitationClick(cite)}
        className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-cyan-900/40 hover:bg-cyan-900/70 text-cyan-300 rounded border border-cyan-700/30 align-baseline"
        title={cite.filePath}
      >
        {shortPath(cite.filePath)}
        {cite.startLine ? `:${cite.startLine}` : ''}
      </button>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length)
    parts.push(<React.Fragment key={`t-${lastIdx}`}>{formatRich(text.slice(lastIdx))}</React.Fragment>);
  return parts;
}

function parseCitation(raw: string): ChatCitation {
  // file/path/here.ts:12-30 OR file/path:12 OR file/path
  const colonIdx = raw.lastIndexOf(':');
  if (colonIdx > 0 && /^\d/.test(raw.slice(colonIdx + 1))) {
    const filePath = raw.slice(0, colonIdx);
    const range = raw.slice(colonIdx + 1);
    const [a, b] = range.split('-').map((s) => parseInt(s, 10));
    return { filePath, startLine: a, endLine: b };
  }
  return { filePath: raw };
}

function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

function formatRich(s: string): React.ReactNode {
  // simple inline: **bold** and `code`
  const tokens: React.ReactNode[] = [];
  let cursor = 0;
  // We tokenize by walking matches of either pattern, choosing the earliest each step.
  while (cursor < s.length) {
    BOLD_RE.lastIndex = cursor;
    CODE_RE.lastIndex = cursor;
    const b = BOLD_RE.exec(s);
    const c = CODE_RE.exec(s);
    let next: { match: RegExpExecArray; type: 'b' | 'c' } | null = null;
    if (b && c) next = b.index < c.index ? { match: b, type: 'b' } : { match: c, type: 'c' };
    else if (b) next = { match: b, type: 'b' };
    else if (c) next = { match: c, type: 'c' };
    if (!next) {
      tokens.push(s.slice(cursor));
      break;
    }
    if (next.match.index > cursor) tokens.push(s.slice(cursor, next.match.index));
    if (next.type === 'b') {
      tokens.push(<strong key={`b-${next.match.index}`} className="text-white">{next.match[1]}</strong>);
    } else {
      tokens.push(
        <code
          key={`c-${next.match.index}`}
          className="px-1 py-0.5 rounded bg-gray-950 text-cyan-300 font-mono text-[11px]"
        >
          {next.match[1]}
        </code>,
      );
    }
    cursor = next.match.index + next.match[0].length;
  }
  return <>{tokens}</>;
}


