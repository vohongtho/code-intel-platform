import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { CodeNode } from 'code-intel-shared';
import { useAppState } from '../../state/app-context';
import { ApiClient } from '../../api/client';
import type { GQLResult, CountGroup } from '../../api/client';

const HISTORY_KEY = 'code-intel:query-history';
const MAX_HISTORY = 20;

const EXAMPLE_QUERIES = [
  'FIND function WHERE name CONTAINS "auth"',
  'FIND * WHERE kind IN [function, method] LIMIT 20',
  'TRAVERSE CALLS FROM "main" DEPTH 3',
  'COUNT function GROUP BY cluster',
  'FIND function WHERE exported = true LIMIT 30',
];

const GQL_KEYWORDS =
  /\b(FIND|TRAVERSE|PATH|COUNT|WHERE|FROM|TO|DEPTH|LIMIT|OFFSET|GROUP|BY|AND|IN|CONTAINS|STARTS_WITH)\b/g;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[]; }
  catch { return []; }
}

function saveHistory(history: string[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function addToHistory(query: string): void {
  const history = loadHistory().filter((q) => q !== query);
  history.unshift(query);
  saveHistory(history);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightGQL(text: string): string {
  return escapeHtml(text).replace(
    GQL_KEYWORDS,
    '<span style="color:#7c3aed;font-weight:600">$1</span>',
  );
}

interface SortState { column: string; direction: 'asc' | 'desc' }

function NodeTable({ nodes, onSelectNode }: { nodes: CodeNode[]; onSelectNode: (node: CodeNode) => void }) {
  const [sort, setSort] = useState<SortState>({ column: 'name', direction: 'asc' });

  const toggleSort = (col: string) =>
    setSort((prev) =>
      prev.column === col
        ? { column: col, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column: col, direction: 'asc' },
    );

  const sorted = [...nodes].sort((a, b) => {
    const aVal = String((a as unknown as Record<string, unknown>)[sort.column] ?? '');
    const bVal = String((b as unknown as Record<string, unknown>)[sort.column] ?? '');
    return sort.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'kind', label: 'Kind' },
    { key: 'filePath', label: 'File' },
  ];

  const sortIndicator = (col: string) =>
    sort.column !== col
      ? <span className="text-text-muted ml-1">↕</span>
      : <span className="text-accent ml-1">{sort.direction === 'asc' ? '↑' : '↓'}</span>;

  return (
    <div className="overflow-auto max-h-64 rounded-md border border-border-subtle">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead className="sticky top-0 bg-deep z-10">
          <tr>
            {cols.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="px-2 py-1.5 text-left text-text-muted font-semibold cursor-pointer hover:text-text-secondary select-none border-b border-border-subtle whitespace-nowrap"
              >
                {col.label}{sortIndicator(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((node, idx) => (
            <tr
              key={node.id ?? idx}
              onClick={() => onSelectNode(node)}
              className="cursor-pointer hover:bg-accent/10 transition-colors"
            >
              <td className="px-2 py-1 text-accent truncate max-w-[120px]" title={node.name}>{node.name}</td>
              <td className="px-2 py-1 text-node-interface">{node.kind}</td>
              <td className="px-2 py-1 text-text-muted truncate max-w-[180px]" title={node.filePath ?? ''}>{node.filePath ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupTable({ groups }: { groups: CountGroup[] }) {
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  return (
    <div className="overflow-auto max-h-48 rounded-md border border-border-subtle">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead className="sticky top-0 bg-deep z-10">
          <tr>
            <th className="px-2 py-1.5 text-left text-text-muted font-semibold border-b border-border-subtle">Group</th>
            <th className="px-2 py-1.5 text-left text-text-muted font-semibold border-b border-border-subtle">Count</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ key, count }) => (
            <tr key={key} className="hover:bg-hover transition-colors">
              <td className="px-2 py-1 text-accent">{key}</td>
              <td className="px-2 py-1 text-text-primary font-bold">{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueryPanel() {
  const { state, dispatch } = useAppState();

  const [gql, setGql] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GQLResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.innerHTML = highlightGQL(gql) + '\n';
    }
  }, [gql]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const runQuery = useCallback(async () => {
    const query = gql.trim();
    if (!query || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const client = new ApiClient(state.serverUrl);
      const res = await client.queryGQL(query);
      setResult(res);
      addToHistory(query);
      setHistory(loadHistory());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [gql, loading, state.serverUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void runQuery(); }
    },
    [runQuery],
  );

  const handleSelectNode = useCallback(
    (node: CodeNode) => dispatch({ type: 'SELECT_NODE', node }),
    [dispatch],
  );

  const hasNodes  = result && result.nodes.length > 0;
  const hasGroups = result && result.groups && result.groups.length > 0;

  const selectClass =
    'w-full bg-deep border border-border-subtle rounded text-[11px] text-text-secondary px-2 py-1 focus:outline-none focus:border-accent cursor-pointer';

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-subtle flex-shrink-0">
        <h3 className="text-[10px] font-bold tracking-wider text-accent/80 uppercase">
          GQL Query Console
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-2">
        {/* Examples */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 font-semibold uppercase tracking-wider">Examples</label>
          <select onChange={(e) => { if (e.target.value) { setGql(e.target.value); e.target.value = ''; } }} defaultValue="" className={selectClass}>
            <option value="" disabled>— pick an example —</option>
            {EXAMPLE_QUERIES.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div>
            <label className="block text-[10px] text-text-muted mb-1 font-semibold uppercase tracking-wider">History</label>
            <select onChange={(e) => { if (e.target.value) { setGql(e.target.value); e.target.value = ''; } }} defaultValue="" className={selectClass}>
              <option value="" disabled>— recent queries —</option>
              {history.map((q, i) => <option key={i} value={q}>{q.length > 60 ? q.slice(0, 57) + '…' : q}</option>)}
            </select>
          </div>
        )}

        {/* Editor with syntax highlight overlay */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1 font-semibold uppercase tracking-wider">
            Query <span className="text-text-muted/50 normal-case font-normal">(Ctrl+Enter to run)</span>
          </label>
          <div className="relative" style={{ height: '100px' }}>
            <div
              ref={overlayRef}
              aria-hidden="true"
              className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none rounded-md border border-transparent"
              style={{
                fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                fontSize: '11px', lineHeight: '1.5', padding: '6px 8px',
                color: 'transparent', background: '#0a0a10', wordBreak: 'break-word', zIndex: 0,
              }}
            />
            <textarea
              ref={textareaRef}
              value={gql}
              onChange={(e) => setGql(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={syncScroll}
              spellCheck={false}
              placeholder='FIND function WHERE name CONTAINS "auth"'
              className="absolute inset-0 w-full h-full resize-none rounded-md border border-border-subtle focus:outline-none focus:border-accent"
              style={{
                fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                fontSize: '11px', lineHeight: '1.5', padding: '6px 8px',
                background: 'transparent', color: '#e4e4ed', caretColor: '#e4e4ed', zIndex: 1,
              }}
            />
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={() => void runQuery()}
          disabled={loading || !gql.trim()}
          className="w-full py-1.5 rounded-md text-xs font-semibold tracking-wide transition flex items-center justify-center gap-2 bg-accent hover:opacity-90 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Running…
            </>
          ) : <>▶ Run</>}
        </button>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-700/60 bg-red-900/20 px-3 py-2">
            <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-0.5">Error</p>
            <p className="text-[11px] text-red-300 font-mono break-words">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-[10px] text-text-muted">
              <span><span className="text-text-primary font-semibold">{result.totalCount}</span> result{result.totalCount !== 1 ? 's' : ''}</span>
              <span><span className="text-text-primary font-semibold">{result.executionTimeMs}</span> ms</span>
              {result.truncated && <span className="text-amber-400 font-semibold">⚠ truncated</span>}
            </div>
            {hasNodes && <NodeTable nodes={result.nodes} onSelectNode={handleSelectNode} />}
            {hasGroups && result.groups && <GroupTable groups={result.groups} />}
            {result.edges && result.edges.length > 0 && (
              <p className="text-[10px] text-text-muted">
                + <span className="text-text-primary">{result.edges.length}</span> edge{result.edges.length !== 1 ? 's' : ''} in result
              </p>
            )}
            {!hasNodes && !hasGroups && <p className="text-[11px] text-text-muted italic">No results.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
