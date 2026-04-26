import React, { useEffect, useState } from 'react';
import type { CodeNode, NodeKind } from '@code-intel/shared';
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
      depth === 1 ? 'border-red-700 bg-red-900/20' :
      depth === 2 ? 'border-yellow-700 bg-yellow-900/20' :
      'border-gray-700 bg-gray-800';
    return (
      <button
        onClick={() => jumpTo(id)}
        className={`inline-flex items-center gap-1.5 border rounded px-2 py-0.5 text-xs text-gray-200 max-w-full truncate hover:brightness-125 transition ${depthColor}`}
        title={id}
      >
        {kind && (
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: NODE_COLORS[kind as NodeKind] ?? '#666' }}
          />
        )}
        <span className="truncate">{name ?? '(unknown)'}</span>
        {depth != null && <span className="text-[9px] text-gray-500 ml-0.5">d{depth}</span>}
      </button>
    );
  };

  const tabs: Tab[] = ['overview', 'connections', 'impact', 'source'];
  const connectionCount = info ? info.callers.length + info.callees.length + info.imports.length : 0;
  const impactCount = impact?.affectedCount ?? 0;

  return (
    <div className="h-72 bg-[#080b14] border-t border-gray-800 flex flex-col overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/80 bg-[#0a0d18]">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-offset-[#0a0d18]"
            style={{ backgroundColor: NODE_COLORS[node.kind as NodeKind] ?? '#666' }}
          />
          <h3 className="font-semibold text-white truncate">{node.name}</h3>
          <span className="text-[10px] uppercase bg-gray-800/80 text-gray-400 px-1.5 py-0.5 rounded font-mono border border-gray-700/50">
            {node.kind}
          </span>
          {node.exported && (
            <span className="text-[10px] bg-emerald-900/40 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/40">
              exported
            </span>
          )}
          {info?.callers && info.callers.length === 0 && ['function', 'method'].includes(node.kind) && (
            <span className="text-[10px] bg-blue-900/30 text-blue-400 px-1.5 py-0.5 rounded border border-blue-800/40">
              entry point
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-600 font-mono mr-2">
            {node.filePath?.split('/').slice(-2).join('/')}
          </span>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white text-lg px-2 transition leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800/60 px-2 bg-[#090c16]">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize font-medium transition relative ${
              tab === t
                ? 'text-cyan-400 border-b-2 border-cyan-500 bg-cyan-500/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t}
            {t === 'connections' && connectionCount > 0 && (
              <span className="ml-1 text-[9px] text-gray-600 bg-gray-800 px-1 rounded-full">
                {connectionCount}
              </span>
            )}
            {t === 'impact' && impactCount > 0 && (
              <span className={`ml-1 text-[9px] px-1 rounded-full ${impactCount > 10 ? 'text-red-300 bg-red-900/40' : 'text-yellow-300 bg-yellow-900/30'}`}>
                {impactCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <Field label="File" value={node.filePath} mono />
              <Field
                label="Lines"
                value={node.startLine ? `${node.startLine}${node.endLine ? `–${node.endLine}` : ''}` : '—'}
              />
              {info?.cluster && <Field label="Cluster" value={info.cluster} />}
              <Field label="ID" value={node.id} mono tiny />
            </div>

            {/* Mini call stats */}
            {info && (
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: 'Callers', count: info.callers.length, color: 'text-red-400', bg: 'bg-red-900/20 border-red-800/40' },
                  { label: 'Callees', count: info.callees.length, color: 'text-sky-400', bg: 'bg-sky-900/20 border-sky-800/40' },
                  { label: 'Imports', count: info.imports.length, color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-800/40' },
                  { label: 'Members', count: info.members.length, color: 'text-green-400', bg: 'bg-green-900/20 border-green-800/40' },
                ].filter((s) => s.count > 0).map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setTab('connections')}
                    className={`flex items-center gap-1.5 text-[11px] border rounded px-2 py-1 ${s.bg} transition hover:brightness-125`}
                  >
                    <span className={`font-bold ${s.color}`}>{s.count}</span>
                    <span className="text-gray-400">{s.label}</span>
                  </button>
                ))}
                <button
                  onClick={() => setTab('impact')}
                  className="flex items-center gap-1.5 text-[11px] border rounded px-2 py-1 bg-orange-900/20 border-orange-800/40 transition hover:brightness-125"
                >
                  <span className="font-bold text-orange-400">⚡</span>
                  <span className="text-gray-400">Impact</span>
                </button>
              </div>
            )}

            {Boolean(node.metadata?.signature) && (
              <div>
                <p className="text-gray-500 text-[10px] uppercase mb-1">Signature</p>
                <pre className="text-xs text-cyan-300 bg-gray-950 rounded p-2 overflow-x-auto border border-gray-800">
                  {String(node.metadata?.signature)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* CONNECTIONS */}
        {tab === 'connections' && (
          <div className="space-y-3">
            {loadingInfo && (
              <p className="text-gray-500 text-xs animate-pulse">Loading connections…</p>
            )}
            {info && (
              <>
                <ConnectionGroup
                  label="Callers" hint="Functions that call this" accent="text-red-400"
                  items={info.callers.map((c) => ({ id: c.id, name: c.name, kind: 'function' }))}
                  Pill={Pill}
                />
                <ConnectionGroup
                  label="Callees" hint="Functions called by this" accent="text-sky-400"
                  items={info.callees.map((c) => ({ id: c.id, name: c.name, kind: 'function' }))}
                  Pill={Pill}
                />
                <ConnectionGroup
                  label="Imports"
                  items={info.imports.map((c) => ({ id: c.id, name: c.name, kind: 'module' }))}
                  Pill={Pill}
                />
                <ConnectionGroup
                  label="Imported By"
                  items={info.importedBy.map((c) => ({ id: c.id, name: c.name, kind: 'module' }))}
                  Pill={Pill}
                />
                <ConnectionGroup
                  label="Extends"
                  items={info.extends.map((c) => ({ id: c.id, name: c.name, kind: 'class' }))}
                  Pill={Pill}
                />
                <ConnectionGroup
                  label="Implements"
                  items={info.implementsEdges.map((c) => ({ id: c.id, name: c.name, kind: 'interface' }))}
                  Pill={Pill}
                />
                <ConnectionGroup
                  label="Members"
                  items={info.members.map((m) => ({ id: m.id, name: m.name, kind: m.kind }))}
                  Pill={Pill}
                />
              </>
            )}
            {info && connectionCount === 0 && (
              <p className="text-gray-500 text-xs italic">No connections recorded.</p>
            )}
          </div>
        )}

        {/* IMPACT */}
        {tab === 'impact' && (
          <div className="space-y-3">
            {loadingImpact && (
              <p className="text-gray-500 text-xs animate-pulse">Calculating blast radius…</p>
            )}
            {!loadingImpact && !impact && (
              <p className="text-gray-500 text-xs italic">No impact data.</p>
            )}
            {impact && (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`text-2xl font-bold font-mono ${
                    impact.affectedCount > 10 ? 'text-red-400' :
                    impact.affectedCount > 5  ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {impact.affectedCount}
                  </div>
                  <div>
                    <p className="text-xs text-gray-300">affected symbols</p>
                    <p className="text-[10px] text-gray-600">
                      {impact.affectedCount > 10 ? '⚠ HIGH blast radius' :
                       impact.affectedCount > 5  ? '⚡ MEDIUM blast radius' :
                       '✓ LOW blast radius'}
                    </p>
                  </div>
                </div>

                {/* Depth breakdown */}
                {[1, 2, 3].map((d) => {
                  const atDepth = impact.affected.filter((a) => a.depth === d);
                  if (atDepth.length === 0) return null;
                  return (
                    <div key={d}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          d === 1 ? 'text-red-400' : d === 2 ? 'text-yellow-400' : 'text-gray-400'
                        }`}>
                          d={d} {d === 1 ? '· WILL BREAK' : d === 2 ? '· LIKELY AFFECTED' : '· MAY NEED TESTING'}
                        </span>
                        <span className="text-[10px] text-gray-600">{atDepth.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {atDepth.slice(0, 20).map((a, i) => (
                          <Pill key={`${a.id}-${i}`} id={a.id} name={a.name} kind={a.kind} depth={d} />
                        ))}
                        {atDepth.length > 20 && (
                          <span className="text-[10px] text-gray-600 self-center">
                            +{atDepth.length - 20}
                          </span>
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
              <pre className="text-xs text-gray-300 bg-gray-950 rounded p-3 overflow-x-auto border border-gray-800 leading-relaxed">
                <code>{node.content}</code>
              </pre>
            ) : (
              <p className="text-gray-500 text-xs italic">No source preview available.</p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  mono,
  tiny,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tiny?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-gray-500 text-[10px] uppercase mb-0.5">{label}</p>
      <p
        className={`text-gray-200 truncate ${mono ? 'font-mono' : ''} ${tiny ? 'text-[10px]' : 'text-xs'}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function ConnectionGroup({
  label,
  hint,
  accent = 'text-gray-500',
  items,
  Pill,
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
        <span className="text-[10px] text-gray-600 bg-gray-800/60 px-1 rounded-full">{items.length}</span>
        {hint && <span className="text-[10px] text-gray-700">— {hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 50).map((item, i) => (
          <Pill key={`${item.id}-${i}`} {...item} />
        ))}
        {items.length > 50 && (
          <span className="text-[10px] text-gray-600 self-center">+{items.length - 50} more</span>
        )}
      </div>
    </div>
  );
}
