import React, { useEffect, useState } from 'react';
import type { CodeNode, NodeKind } from 'code-intel-shared';
import { NODE_COLORS } from '../../graph/colors';
import { ApiClient, type NodeInspectInfo, type BlastRadiusResult } from '../../api/client';
import { useAppState } from '../../state/app-context';

interface Props {
  node: CodeNode;
  onClose: () => void;
}

type Tab = 'overview' | 'connections' | 'impact' | 'source';

export function NodeDetail({ node, onClose }: Props) {
  const { state, dispatch } = useAppState();
  const [info, setInfo] = useState<NodeInspectInfo | null>(null);
  const [impact, setImpact] = useState<BlastRadiusResult | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setImpact(null);
    setLoadingInfo(true);
    const client = new ApiClient(state.serverUrl);
    client
      .inspectNode(node.id)
      .then((data) => { if (!cancelled) setInfo(data); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoadingInfo(false); });
    return () => { cancelled = true; };
  }, [node.id, state.serverUrl]);

  const loadImpact = async () => {
    if (impact || loadingImpact) return;
    setLoadingImpact(true);
    try {
      const client = new ApiClient(state.serverUrl);
      const data = await client.blastRadius(node.id, 'both', 3);
      setImpact(data);
    } catch { /* ignore */ }
    finally { setLoadingImpact(false); }
  };

  useEffect(() => {
    if (tab === 'impact') loadImpact();
  }, [tab]);

  const jumpTo = (targetId?: string) => {
    if (!targetId) return;
    const found = state.nodes.find((n) => n.id === targetId);
    if (found) dispatch({ type: 'SELECT_NODE', node: found });
  };

  const Pill: React.FC<{ kind?: string; name?: string; id?: string; depth?: number }> = ({ kind, name, id, depth }) => {
    const depthColor =
      depth === 1 ? 'border-red-700/50 bg-red-900/20' :
      depth === 2 ? 'border-amber-700/50 bg-amber-900/20' :
      'border-border-default bg-elevated';
    return (
      <button
        onClick={() => jumpTo(id)}
        className={`inline-flex items-center gap-1.5 border rounded px-2 py-0.5 text-xs text-text-secondary max-w-full truncate hover:brightness-125 transition ${depthColor}`}
        title={id}
      >
        {kind && (
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[kind as NodeKind] ?? '#666' }} />
        )}
        <span className="truncate">{name ?? '(unknown)'}</span>
        {depth != null && <span className="text-[9px] text-text-muted ml-0.5">d{depth}</span>}
      </button>
    );
  };

  const tabs: Tab[] = ['overview', 'connections', 'impact', 'source'];
  const connectionCount = info ? info.callers.length + info.callees.length + info.imports.length : 0;
  const impactCount = impact?.affectedCount ?? 0;

  return (
    <div className="h-72 bg-deep border-t border-border-subtle flex flex-col overflow-hidden shadow-2xl shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-offset-surface"
            style={{ backgroundColor: NODE_COLORS[node.kind as NodeKind] ?? '#666' }}
          />
          <h3 className="font-semibold text-text-primary truncate">{node.name}</h3>
          <span className="text-[10px] uppercase bg-elevated text-text-muted px-1.5 py-0.5 rounded font-mono border border-border-subtle">
            {node.kind}
          </span>
          {node.exported && (
            <span className="text-[10px] bg-node-function/10 text-node-function px-1.5 py-0.5 rounded border border-node-function/30">
              exported
            </span>
          )}
          {info?.callers && info.callers.length === 0 && ['function', 'method'].includes(node.kind) && (
            <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded border border-accent/30">
              entry point
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-muted font-mono mr-2">
            {node.filePath?.split('/').slice(-2).join('/')}
          </span>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg px-2 transition leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-subtle px-2 bg-deep">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize font-medium transition relative ${
              tab === t
                ? 'text-accent border-b-2 border-accent bg-accent/5'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t}
            {t === 'connections' && connectionCount > 0 && (
              <span className="ml-1 text-[9px] text-text-muted bg-elevated px-1 rounded-full">
                {connectionCount}
              </span>
            )}
            {t === 'impact' && impactCount > 0 && (
              <span className={`ml-1 text-[9px] px-1 rounded-full ${
                impactCount > 10 ? 'text-red-300 bg-red-900/40' : 'text-amber-300 bg-amber-900/30'
              }`}>
                {impactCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 text-sm">

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <Field label="File" value={node.filePath ?? '—'} mono />
              <Field label="Lines" value={node.startLine ? `${node.startLine}${node.endLine ? `–${node.endLine}` : ''}` : '—'} />
              {info?.cluster && <Field label="Cluster" value={info.cluster} />}
              <Field label="ID" value={node.id} mono tiny />
            </div>

            {info && (
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: 'Callers', count: info.callers.length,  color: 'text-red-400',           bg: 'bg-red-900/20 border-red-800/40' },
                  { label: 'Callees', count: info.callees.length,  color: 'text-accent',             bg: 'bg-accent/10 border-accent/30' },
                  { label: 'Imports', count: info.imports.length,  color: 'text-node-interface',     bg: 'bg-node-interface/10 border-node-interface/30' },
                  { label: 'Members', count: info.members.length,  color: 'text-node-function',      bg: 'bg-node-function/10 border-node-function/30' },
                ].filter((s) => s.count > 0).map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setTab('connections')}
                    className={`flex items-center gap-1.5 text-[11px] border rounded px-2 py-1 ${s.bg} transition hover:brightness-125`}
                  >
                    <span className={`font-bold ${s.color}`}>{s.count}</span>
                    <span className="text-text-muted">{s.label}</span>
                  </button>
                ))}
                <button
                  onClick={() => setTab('impact')}
                  className="flex items-center gap-1.5 text-[11px] border rounded px-2 py-1 bg-amber-900/20 border-amber-800/40 transition hover:brightness-125"
                >
                  <span className="font-bold text-amber-400">⚡</span>
                  <span className="text-text-muted">Impact</span>
                </button>
              </div>
            )}

            {Boolean(node.metadata?.signature) && (
              <div>
                <p className="text-text-muted text-[10px] uppercase mb-1">Signature</p>
                <pre className="text-xs text-accent bg-void rounded p-2 overflow-x-auto border border-border-subtle">
                  {String(node.metadata?.signature)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* CONNECTIONS */}
        {tab === 'connections' && (
          <div className="space-y-3">
            {loadingInfo && <p className="text-text-muted text-xs animate-pulse">Loading connections…</p>}
            {info && (
              <>
                <ConnectionGroup label="Callers"     hint="Functions that call this" accent="text-red-400"       items={info.callers.map((c) => ({ id: c.id, name: c.name, kind: 'function' }))}    Pill={Pill} />
                <ConnectionGroup label="Callees"     hint="Functions called by this" accent="text-accent"        items={info.callees.map((c) => ({ id: c.id, name: c.name, kind: 'function' }))}    Pill={Pill} />
                <ConnectionGroup label="Imports"                                                                  items={info.imports.map((c) => ({ id: c.id, name: c.name, kind: 'module' }))}      Pill={Pill} />
                <ConnectionGroup label="Imported By"                                                             items={info.importedBy.map((c) => ({ id: c.id, name: c.name, kind: 'module' }))}   Pill={Pill} />
                <ConnectionGroup label="Extends"                                                                  items={info.extends.map((c) => ({ id: c.id, name: c.name, kind: 'class' }))}       Pill={Pill} />
                <ConnectionGroup label="Implements"                                                               items={info.implementsEdges.map((c) => ({ id: c.id, name: c.name, kind: 'interface' }))} Pill={Pill} />
                <ConnectionGroup label="Members"                                                                  items={info.members.map((m) => ({ id: m.id, name: m.name, kind: m.kind }))}        Pill={Pill} />
              </>
            )}
            {info && connectionCount === 0 && <p className="text-text-muted text-xs italic">No connections recorded.</p>}
          </div>
        )}

        {/* IMPACT */}
        {tab === 'impact' && (
          <div className="space-y-3">
            {loadingImpact && <p className="text-text-muted text-xs animate-pulse">Calculating blast radius…</p>}
            {!loadingImpact && !impact && <p className="text-text-muted text-xs italic">No impact data.</p>}
            {impact && (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`text-2xl font-bold font-mono ${
                    impact.affectedCount > 10 ? 'text-red-400' :
                    impact.affectedCount > 5  ? 'text-amber-400' :
                    'text-node-function'
                  }`}>
                    {impact.affectedCount}
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary">affected symbols</p>
                    <p className="text-[10px] text-text-muted">
                      {impact.affectedCount > 10 ? '⚠ HIGH blast radius' :
                       impact.affectedCount > 5  ? '⚡ MEDIUM blast radius' :
                       '✓ LOW blast radius'}
                    </p>
                  </div>
                </div>
                {[1, 2, 3].map((d) => {
                  const atDepth = impact.affected.filter((a) => a.depth === d);
                  if (atDepth.length === 0) return null;
                  return (
                    <div key={d}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          d === 1 ? 'text-red-400' : d === 2 ? 'text-amber-400' : 'text-text-muted'
                        }`}>
                          d={d} {d === 1 ? '· WILL BREAK' : d === 2 ? '· LIKELY AFFECTED' : '· MAY NEED TESTING'}
                        </span>
                        <span className="text-[10px] text-text-muted">{atDepth.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {atDepth.slice(0, 20).map((a, i) => (
                          <Pill key={`${a.id}-${i}`} id={a.id} name={a.name} kind={a.kind} depth={d} />
                        ))}
                        {atDepth.length > 20 && (
                          <span className="text-[10px] text-text-muted self-center">+{atDepth.length - 20}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* SOURCE */}
        {tab === 'source' && (
          <div>
            {node.content ? (
              <pre className="text-xs text-text-secondary bg-void rounded p-3 overflow-x-auto border border-border-subtle leading-relaxed">
                <code>{node.content}</code>
              </pre>
            ) : (
              <p className="text-text-muted text-xs italic">No source preview available.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono, tiny }: { label: string; value: string; mono?: boolean; tiny?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-text-muted text-[10px] uppercase mb-0.5">{label}</p>
      <p className={`text-text-secondary truncate ${mono ? 'font-mono' : ''} ${tiny ? 'text-[10px]' : 'text-xs'}`} title={value}>
        {value}
      </p>
    </div>
  );
}

function ConnectionGroup({
  label, hint, accent = 'text-text-muted', items, Pill,
}: {
  label: string;
  hint?: string;
  accent?: string;
  items: { id: string; name?: string; kind?: string }[];
  Pill: React.FC<{ kind?: string; name?: string; id?: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h4 className={`text-[10px] font-bold uppercase tracking-wider ${accent}`}>{label}</h4>
        <span className="text-[10px] text-text-muted bg-elevated px-1 rounded-full">{items.length}</span>
        {hint && <span className="text-[10px] text-text-muted/50">— {hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 50).map((item, i) => (
          <Pill key={`${item.id}-${i}`} {...item} />
        ))}
        {items.length > 50 && (
          <span className="text-[10px] text-text-muted self-center">+{items.length - 50} more</span>
        )}
      </div>
    </div>
  );
}
