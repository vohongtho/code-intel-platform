import React, { useEffect, useRef, useState } from 'react';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';
import { runAgent } from '../../ai/agent';
import type { ChatMessage, ChatCitation, ChatToolCall } from '../../state/types';

const SUGGESTIONS = [
  { label: 'Architecture', items: ['Explain the project architecture', 'What are the main modules?'] },
  { label: 'Search',       items: ['Find code about HTTP server', 'Who calls runPipeline'] },
  { label: 'Inspect',      items: ['Inspect KnowledgeGraph', 'Impact of textSearch'] },
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
    dispatch({ type: 'ADD_CHAT_MESSAGE', message: { role: 'user', content: trimmed, timestamp: Date.now() } });
    dispatch({ type: 'SET_CHAT_LOADING', loading: true });
    dispatch({ type: 'ADD_CHAT_MESSAGE', message: { role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], citations: [] } });
    const client = new ApiClient(state.serverUrl);
    const toolCalls: ChatToolCall[] = [];
    try {
      await runAgent(trimmed, client, (ev) => {
        if (ev.type === 'tool-start' && ev.toolCall) {
          toolCalls.push(ev.toolCall);
          dispatch({ type: 'UPDATE_LAST_CHAT_MESSAGE', message: { toolCalls: [...toolCalls] } });
        } else if (ev.type === 'tool-end' && ev.toolCall) {
          const idx = toolCalls.findIndex((c) => c.tool === ev.toolCall!.tool && c.status === 'running');
          if (idx >= 0) toolCalls[idx] = ev.toolCall;
          else toolCalls.push(ev.toolCall);
          dispatch({ type: 'UPDATE_LAST_CHAT_MESSAGE', message: { toolCalls: [...toolCalls] } });
        } else if (ev.type === 'final') {
          dispatch({ type: 'UPDATE_LAST_CHAT_MESSAGE', message: { content: ev.text ?? '', citations: ev.citations ?? [] } });
        }
      });
    } catch (err) {
      dispatch({ type: 'UPDATE_LAST_CHAT_MESSAGE', message: { content: `Error: ${err instanceof Error ? err.message : 'unknown'}` } });
    } finally {
      dispatch({ type: 'SET_CHAT_LOADING', loading: false });
    }
  };

  const onCitationClick = (c: ChatCitation) => {
    if (c.nodeId) {
      const node = state.nodes.find((n) => n.id === c.nodeId);
      if (node) { dispatch({ type: 'SELECT_NODE', node }); return; }
    }
    const fileNode = state.nodes.find((n) => n.kind === 'file' && n.filePath === c.filePath);
    if (fileNode) dispatch({ type: 'SELECT_NODE', node: fileNode });
  };

  return (
    <div className="flex flex-col h-full bg-deep">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-2">
          <span className="text-accent">✦</span>
          <h3 className="text-sm font-semibold text-text-primary">Code AI</h3>
          <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full border border-accent/30">
            Grounded
          </span>
        </div>
        <button
          onClick={() => dispatch({ type: 'CLEAR_CHAT' })}
          className="text-[10px] text-text-muted hover:text-text-secondary px-2 py-1 rounded hover:bg-hover transition"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {state.chat.messages.length === 0 && (
          <div className="mt-4 px-2">
            <p className="text-text-muted text-xs mb-3 leading-relaxed text-center">
              Ask grounded questions. Every answer cites source files.
            </p>
            <div className="space-y-3">
              {SUGGESTIONS.map(({ label, items }) => (
                <div key={label}>
                  <p className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-1 px-1">
                    {label}
                  </p>
                  <div className="space-y-1">
                    {items.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="block w-full text-left px-2.5 py-1.5 text-xs bg-elevated hover:bg-hover text-text-secondary hover:text-text-primary rounded-lg border border-border-subtle hover:border-border-default transition"
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
          <div className="flex items-center gap-2 text-text-muted text-xs">
            <div className="animate-spin w-3 h-3 border-2 border-border-default border-t-accent rounded-full" />
            Thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-border-subtle bg-surface">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            disabled={state.chat.loading}
            className="flex-1 bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none disabled:opacity-50 transition"
            placeholder="Ask about the codebase…"
          />
          <button
            onClick={() => send(input)}
            disabled={state.chat.loading || !input.trim()}
            className="bg-gradient-to-r from-accent to-accent-dim hover:opacity-90 disabled:opacity-40 rounded-lg px-3 py-1.5 text-sm text-white transition"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, onCitationClick }: { message: ChatMessage; onCitationClick: (c: ChatCitation) => void }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] bg-accent/15 border border-accent/30 text-text-primary rounded-lg px-3 py-1.5 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-1">
          {message.toolCalls.map((tc, i) => <ToolCallChip key={i} tc={tc} />)}
        </div>
      )}
      {message.content && (
        <div className="bg-elevated/60 border border-border-subtle rounded-lg p-3 text-sm text-text-secondary">
          <RichText text={message.content} onCitationClick={onCitationClick} />
        </div>
      )}
    </div>
  );
}

function ToolCallChip({ tc }: { tc: ChatToolCall }) {
  const colorClass =
    tc.status === 'done'  ? 'border-node-function/40 text-node-function' :
    tc.status === 'error' ? 'border-red-700/40 text-red-400' :
    'border-border-default text-text-muted animate-pulse';
  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded border bg-surface text-xs ${colorClass}`}>
      <span className="font-mono">⚙</span>
      <span className="font-mono font-medium">{tc.tool}</span>
      <span className="text-text-muted truncate flex-1">
        {tc.resultSummary ?? Object.values(tc.input).slice(0, 1).join(' ')}
      </span>
      <span className="text-[10px]">
        {tc.status === 'running' ? '…' : tc.status === 'done' ? '✓' : '✗'}
      </span>
    </div>
  );
}

function RichText({ text, onCitationClick }: { text: string; onCitationClick: (c: ChatCitation) => void }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="leading-relaxed">{renderLine(line, onCitationClick)}</div>
      ))}
    </>
  );
}

const CITE_RE = /\[\[([^\]]+)\]\]/g;
const HEAD_RE = /^(#{1,4})\s+(.*)$/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const CODE_RE = /`([^`]+)`/g;

function renderLine(line: string, onCitationClick: (c: ChatCitation) => void): React.ReactNode {
  const head = line.match(HEAD_RE);
  if (head) {
    const level = head[1].length;
    const txt = head[2];
    const Tag = (`h${Math.min(4, level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5');
    const cls = level <= 2
      ? 'text-base font-bold text-text-primary mt-2'
      : level === 3
        ? 'text-sm font-semibold text-text-secondary mt-2'
        : 'text-xs font-semibold text-text-muted mt-1';
    return <Tag className={cls}>{renderInline(txt, onCitationClick)}</Tag>;
  }
  if (line.startsWith('- ')) return <div className="ml-3">• {renderInline(line.slice(2), onCitationClick)}</div>;
  if (line.trim() === '') return <div className="h-1" />;
  return <span>{renderInline(line, onCitationClick)}</span>;
}

function renderInline(text: string, onCitationClick: (c: ChatCitation) => void): React.ReactNode[] {
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
        className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-accent/20 hover:bg-accent/30 text-accent rounded border border-accent/30 align-baseline transition"
        title={cite.filePath}
      >
        {shortPath(cite.filePath)}{cite.startLine ? `:${cite.startLine}` : ''}
      </button>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length)
    parts.push(<React.Fragment key={`t-${lastIdx}`}>{formatRich(text.slice(lastIdx))}</React.Fragment>);
  return parts;
}

function parseCitation(raw: string): ChatCitation {
  const colonIdx = raw.lastIndexOf(':');
  if (colonIdx > 0 && /^\d/.test(raw.slice(colonIdx + 1))) {
    const filePath = raw.slice(0, colonIdx);
    const [a, b] = raw.slice(colonIdx + 1).split('-').map((s) => parseInt(s, 10));
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
  const tokens: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < s.length) {
    BOLD_RE.lastIndex = cursor;
    CODE_RE.lastIndex = cursor;
    const b = BOLD_RE.exec(s);
    const c = CODE_RE.exec(s);
    let next: { match: RegExpExecArray; type: 'b' | 'c' } | null = null;
    if (b && c) next = b.index < c.index ? { match: b, type: 'b' } : { match: c, type: 'c' };
    else if (b) next = { match: b, type: 'b' };
    else if (c) next = { match: c, type: 'c' };
    if (!next) { tokens.push(s.slice(cursor)); break; }
    if (next.match.index > cursor) tokens.push(s.slice(cursor, next.match.index));
    if (next.type === 'b') {
      tokens.push(<strong key={`b-${next.match.index}`} className="text-text-primary">{next.match[1]}</strong>);
    } else {
      tokens.push(
        <code key={`c-${next.match.index}`} className="px-1 py-0.5 rounded bg-void text-accent font-mono text-[11px]">
          {next.match[1]}
        </code>,
      );
    }
    cursor = next.match.index + next.match[0].length;
  }
  return <>{tokens}</>;
}
