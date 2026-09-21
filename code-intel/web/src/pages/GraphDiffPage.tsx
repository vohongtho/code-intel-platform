import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import type { NodeKind, EdgeKind } from 'code-intel-shared';
import { useAppState } from '../state/app-context';
import { Header } from '../components/shared/Header';
import { ApiClient } from '../api/client';
import { NODE_COLORS, EDGE_COLORS } from '../graph/colors';
import type {
  GraphDiffResponse,
  GraphDiffUnavailableResponse,
  EntityDelta,
  RelationshipDelta,
  RelationshipCertainty,
  FlowDelta,
} from '../api/graph-diff-types';

const INPUT = 'w-full h-10 bg-elevated text-text-primary rounded-lg px-3 py-2 border border-border-default focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 placeholder-text-muted transition text-sm font-mono';
const LABEL = 'block text-xs font-medium text-text-secondary uppercase tracking-widest mb-1.5';
const SECTION = 'rounded-xl border border-border-subtle bg-surface p-5 space-y-4';

type DeltaCategory = 'all' | 'nodes' | 'relationships' | 'contracts' | 'flows';

const CERTAINTY_RANK: Record<RelationshipCertainty, number> = { exact: 0, candidate: 1, heuristic: 2 };

function isDegraded(delta: RelationshipDelta): boolean {
  if (delta.kind !== 'changed') return false;
  const baseCertainty = delta.base?.certainty;
  const headCertainty = delta.head?.certainty;
  if (!baseCertainty || !headCertainty) return false;
  return CERTAINTY_RANK[headCertainty] > CERTAINTY_RANK[baseCertainty];
}

export function GraphDiffPage() {
  const { state } = useAppState();
  const navigate = useNavigate();

  const [baseRef, setBaseRef] = useState('main');
  const [headRef, setHeadRef] = useState('HEAD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<GraphDiffUnavailableResponse | null>(null);
  const [result, setResult] = useState<GraphDiffResponse | null>(null);
  const [nodes, setNodes] = useState<EntityDelta[]>([]);
  const [relationships, setRelationships] = useState<RelationshipDelta[]>([]);
  const [loadingMoreNodes, setLoadingMoreNodes] = useState(false);
  const [loadingMoreRels, setLoadingMoreRels] = useState(false);

  const [category, setCategory] = useState<DeltaCategory>('all');
  const [nodeKindFilter, setNodeKindFilter] = useState<NodeKind | 'all'>('all');
  const [edgeKindFilter, setEdgeKindFilter] = useState<EdgeKind | 'all'>('all');
  const [certaintyFilter, setCertaintyFilter] = useState<RelationshipCertainty | 'all'>('all');

  const runDiff = async () => {
    if (!baseRef.trim() || !headRef.trim()) return;
    setLoading(true);
    setError(null);
    setUnavailable(null);
    setResult(null);
    setNodes([]);
    setRelationships([]);
    try {
      const client = new ApiClient(state.serverUrl);
      const outcome = await client.graphDiff({
        base_ref: baseRef.trim(),
        head_ref: headRef.trim(),
        repoId: state.repoId || undefined,
        include_contracts: true,
        allow_cache: true,
      });
      if (outcome.status === 'unavailable') {
        setUnavailable(outcome.detail);
        return;
      }
      setResult(outcome.diff);
      setNodes(outcome.diff.nodes);
      setRelationships(outcome.diff.relationships);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Graph diff failed');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreNodes = async () => {
    if (!result || !result.nodesHasMore || loadingMoreNodes) return;
    setLoadingMoreNodes(true);
    try {
      const client = new ApiClient(state.serverUrl);
      const outcome = await client.graphDiff({
        base_ref: baseRef.trim(),
        head_ref: headRef.trim(),
        repoId: state.repoId || undefined,
        include_contracts: true,
        allow_cache: true,
        nodes_offset: result.nodesOffset + result.nodesLimit,
        nodes_limit: result.nodesLimit,
        relationships_offset: 0,
        relationships_limit: 0,
      });
      if (outcome.status === 'ok') {
        setNodes((prev) => [...prev, ...outcome.diff.nodes]);
        setResult((prev) => prev && ({ ...prev, nodesOffset: outcome.diff.nodesOffset, nodesHasMore: outcome.diff.nodesHasMore }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more nodes');
    } finally {
      setLoadingMoreNodes(false);
    }
  };

  const loadMoreRelationships = async () => {
    if (!result || !result.relationshipsHasMore || loadingMoreRels) return;
    setLoadingMoreRels(true);
    try {
      const client = new ApiClient(state.serverUrl);
      const outcome = await client.graphDiff({
        base_ref: baseRef.trim(),
        head_ref: headRef.trim(),
        repoId: state.repoId || undefined,
        include_contracts: true,
        allow_cache: true,
        nodes_offset: 0,
        nodes_limit: 0,
        relationships_offset: result.relationshipsOffset + result.relationshipsLimit,
        relationships_limit: result.relationshipsLimit,
      });
      if (outcome.status === 'ok') {
        setRelationships((prev) => [...prev, ...outcome.diff.relationships]);
        setResult((prev) => prev && ({ ...prev, relationshipsOffset: outcome.diff.relationshipsOffset, relationshipsHasMore: outcome.diff.relationshipsHasMore }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more relationships');
    } finally {
      setLoadingMoreRels(false);
    }
  };

  const filteredNodes = nodes.filter((n) => nodeKindFilter === 'all' || n.nodeKind === nodeKindFilter);
  const filteredRelationships = relationships.filter((r) => {
    if (edgeKindFilter !== 'all' && r.edgeKind !== edgeKindFilter) return false;
    if (certaintyFilter !== 'all') {
      const c = r.head?.certainty ?? r.base?.certainty;
      if (c !== certaintyFilter) return false;
    }
    return true;
  });

  const showNodes = category === 'all' || category === 'nodes';
  const showRelationships = category === 'all' || category === 'relationships';
  const showContracts = category === 'all' || category === 'contracts';
  const showFlows = category === 'all' || category === 'flows';

  const contractFindings = result?.contracts?.findings ?? [];

  return (
    <div className="flex flex-col min-h-screen bg-void text-text-primary">
      <Header onToggleAI={() => {}} aiOpen={false} />
      <main className="max-w-6xl mx-auto w-full px-6 py-8 space-y-6">
        <div>
          <button
            onClick={() => navigate(state.connected ? '/explore' : '/connect')}
            className="text-sm text-text-muted hover:text-text-primary transition mb-3"
          >
            ← Back
          </button>
          <h1 className="text-3xl font-bold tracking-tight">Semantic Graph Diff</h1>
          <p className="text-text-secondary mt-2 max-w-3xl">
            Compare the independently-analyzed semantic graph between two Git refs: added/removed/changed/moved/renamed
            symbols, relationship certainty changes, and API-contract deltas.
          </p>
        </div>

        <section className={SECTION}>
          <div className="grid md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <label className="block">
              <span className={LABEL}>Base ref</span>
              <input
                className={INPUT}
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runDiff(); }}
                placeholder="main"
              />
            </label>
            <label className="block">
              <span className={LABEL}>Head ref</span>
              <input
                className={INPUT}
                value={headRef}
                onChange={(e) => setHeadRef(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runDiff(); }}
                placeholder="HEAD"
              />
            </label>
            <button
              onClick={runDiff}
              disabled={loading || !baseRef.trim() || !headRef.trim()}
              className="h-10 px-4 rounded-lg bg-gradient-to-r from-accent to-accent-dim text-white font-semibold shadow-glow disabled:opacity-50"
            >
              {loading ? 'Comparing…' : 'Compare'}
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {unavailable && (
          <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-5 space-y-3">
            <h2 className="text-lg font-semibold text-red-300">Couldn't compare — {unavailable.error.message}</h2>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <SnapshotFailureCard label="Base" refLabel={baseRef} snapshot={unavailable.baseSnapshot} />
              <SnapshotFailureCard label="Head" refLabel={headRef} snapshot={unavailable.headSnapshot} />
            </div>
          </div>
        )}

        {result && (
          <>
            {!result.coverage.complete && (
              <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
                <p className="font-semibold mb-1">⚠ Partial coverage — this diff is not exhaustive</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {result.coverage.incompleteReasons.map((reason, i) => <li key={i}>{reason}</li>)}
                </ul>
              </div>
            )}

            <section className={SECTION}>
              <div className="flex flex-wrap items-end gap-4">
                <label className="block">
                  <span className={LABEL}>Category</span>
                  <select className={INPUT.replace('font-mono', '')} value={category} onChange={(e) => setCategory(e.target.value as DeltaCategory)}>
                    <option value="all">All</option>
                    <option value="nodes">Nodes</option>
                    <option value="relationships">Relationships</option>
                    <option value="contracts">API contracts</option>
                    <option value="flows">Flows</option>
                  </select>
                </label>
                <label className="block">
                  <span className={LABEL}>Entity kind</span>
                  <select className={INPUT.replace('font-mono', '')} value={nodeKindFilter} onChange={(e) => setNodeKindFilter(e.target.value as NodeKind | 'all')}>
                    <option value="all">All</option>
                    {[...new Set(nodes.map((n) => n.nodeKind))].sort().map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className={LABEL}>Relationship kind</span>
                  <select className={INPUT.replace('font-mono', '')} value={edgeKindFilter} onChange={(e) => setEdgeKindFilter(e.target.value as EdgeKind | 'all')}>
                    <option value="all">All</option>
                    {[...new Set(relationships.map((r) => r.edgeKind))].sort().map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className={LABEL}>Certainty</span>
                  <select className={INPUT.replace('font-mono', '')} value={certaintyFilter} onChange={(e) => setCertaintyFilter(e.target.value as RelationshipCertainty | 'all')}>
                    <option value="all">All</option>
                    <option value="exact">exact</option>
                    <option value="candidate">candidate</option>
                    <option value="heuristic">heuristic</option>
                  </select>
                </label>
              </div>
            </section>

            {showNodes && (
              <section className={SECTION}>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xl font-semibold">Nodes <span className="text-text-muted text-sm font-normal">({result.nodesTotal})</span></h2>
                </div>
                {filteredNodes.length === 0 && <p className="text-text-muted text-sm italic">No node deltas{nodes.length > 0 ? ' match the current filters.' : '.'}</p>}
                <div className="space-y-1.5">
                  {filteredNodes.map((n, i) => <NodeDeltaRow key={i} delta={n} />)}
                </div>
                {result.nodesHasMore && (
                  <button onClick={loadMoreNodes} disabled={loadingMoreNodes} className="text-sm text-accent hover:text-accent/80 disabled:opacity-50">
                    {loadingMoreNodes ? 'Loading…' : `Load more (${nodes.length} / ${result.nodesTotal})`}
                  </button>
                )}
              </section>
            )}

            {showRelationships && (
              <section className={SECTION}>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-xl font-semibold">Relationships <span className="text-text-muted text-sm font-normal">({result.relationshipsTotal})</span></h2>
                </div>
                {filteredRelationships.length === 0 && <p className="text-text-muted text-sm italic">No relationship deltas{relationships.length > 0 ? ' match the current filters.' : '.'}</p>}
                <div className="space-y-1.5">
                  {filteredRelationships.map((r, i) => <RelationshipDeltaRow key={i} delta={r} />)}
                </div>
                {result.relationshipsHasMore && (
                  <button onClick={loadMoreRelationships} disabled={loadingMoreRels} className="text-sm text-accent hover:text-accent/80 disabled:opacity-50">
                    {loadingMoreRels ? 'Loading…' : `Load more (${relationships.length} / ${result.relationshipsTotal})`}
                  </button>
                )}
              </section>
            )}

            {showContracts && (
              <section className={SECTION}>
                <h2 className="text-xl font-semibold">API contracts</h2>
                {!result.contracts && <p className="text-text-muted text-sm italic">Contract comparison was not requested.</p>}
                {result.contracts && contractFindings.length === 0 && (
                  <p className="text-text-muted text-sm italic">No API-contract compatibility findings between these refs.</p>
                )}
                {result.contracts && contractFindings.length > 0 && (
                  <div className="space-y-1.5">
                    {contractFindings.map((f, i) => (
                      <div key={i} className="border border-border-subtle rounded-lg px-3 py-2 bg-elevated/40 text-sm space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <VerdictBadge verdict={f.verdict} />
                          <span className="font-mono text-xs text-text-secondary">{f.rule}</span>
                          <span className="font-mono text-xs text-text-muted truncate">{f.routeFactId}</span>
                          {f.fieldKey && <span className="text-xs text-text-muted">field: {f.fieldKey}</span>}
                        </div>
                        <p className="text-xs text-text-secondary">{f.reason}</p>
                        {f.affectedConsumerFactIds.length > 0 && (
                          <p className="text-[11px] text-text-muted">{f.affectedConsumerFactIds.length} affected consumer(s)</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {showFlows && (
              <section className={SECTION}>
                <h2 className="text-xl font-semibold">Flows</h2>
                {result.flows.supported ? (
                  result.flows.deltas.length === 0 ? (
                    <p className="text-text-muted text-sm italic">No flow deltas.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {result.flows.deltas.map((f, i) => <FlowDeltaRow key={i} delta={f} />)}
                    </div>
                  )
                ) : (
                  <p className="text-amber-400/90 text-sm">⚠ Not supported yet — {result.flows.reason}</p>
                )}
              </section>
            )}

            {/* Clusters are always unsupported today (see ClusterDiffSection) — shown regardless of the
                category filter so the limitation is never mistaken for "no cluster changes". */}
            <section className={SECTION}>
              <h2 className="text-xl font-semibold">Clusters</h2>
              <p className="text-amber-400/90 text-sm">⚠ Not supported yet — {result.clusters.reason}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function SnapshotFailureCard({ label, refLabel, snapshot }: {
  label: string;
  refLabel: string;
  snapshot: GraphDiffUnavailableResponse['baseSnapshot'];
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated px-4 py-3">
      <p className="text-xs uppercase tracking-widest text-text-muted mb-1">{label} — <span className="font-mono normal-case">{refLabel}</span></p>
      <p className="text-sm text-text-secondary mb-1">Status: <span className="font-mono">{snapshot.status}</span></p>
      {snapshot.error && <p className="text-xs text-red-300 mb-1">{snapshot.error}</p>}
      {snapshot.boundaries.length > 0 && (
        <ul className="list-disc list-inside text-xs text-text-muted space-y-0.5">
          {snapshot.boundaries.map((b, i) => <li key={i}>{b.kind}: {b.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function DeltaKindBadge({ kind }: { kind: EntityDelta['kind'] | RelationshipDelta['kind'] }) {
  const style =
    kind === 'added' ? 'text-node-function bg-node-function/10 border-node-function/30' :
    kind === 'removed' ? 'text-red-400 bg-red-900/20 border-red-800/40' :
    kind === 'changed' ? 'text-amber-400 bg-amber-900/20 border-amber-800/40' :
    kind === 'moved' || kind === 'renamed' ? 'text-accent bg-accent/10 border-accent/30' :
    'text-text-muted bg-elevated border-border-subtle';
  return <span className={`text-[10px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${style}`}>{kind}</span>;
}

function CertaintyPill({ certainty }: { certainty?: RelationshipCertainty }) {
  if (!certainty) return <span className="text-[10px] text-text-muted italic">unknown</span>;
  const style = certainty === 'exact' ? 'text-node-function bg-node-function/10 border-node-function/30'
    : certainty === 'candidate' ? 'text-amber-400 bg-amber-900/20 border-amber-800/40'
    : 'text-red-400 bg-red-900/20 border-red-800/40';
  return <span className={`text-[10px] border rounded px-1.5 py-0.5 font-mono ${style}`}>{certainty}</span>;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const style = verdict === 'compatible' ? 'text-node-function bg-node-function/10 border-node-function/30'
    : verdict === 'breaking' ? 'text-red-400 bg-red-900/20 border-red-800/40'
    : verdict === 'potentially-breaking' ? 'text-amber-400 bg-amber-900/20 border-amber-800/40'
    : 'text-text-muted bg-elevated border-border-subtle';
  return <span className={`text-[10px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${style}`}>{verdict}</span>;
}

function NodeDeltaRow({ delta }: { delta: EntityDelta }) {
  const name = delta.headName ?? delta.baseName ?? '(unknown)';
  const filePath = delta.headFilePath ?? delta.baseFilePath;
  return (
    <div className="border border-border-subtle rounded-lg px-3 py-2 bg-elevated/40 text-sm space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <DeltaKindBadge kind={delta.kind} />
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[delta.nodeKind] ?? '#666' }} />
        <span className="text-xs font-mono text-text-muted">{delta.nodeKind}</span>
        <span className="text-text-primary font-medium truncate">{name}</span>
      </div>
      {(delta.kind === 'moved' || delta.kind === 'renamed') && (delta.baseName || delta.baseFilePath) && (
        <p className="text-[11px] text-text-muted font-mono truncate">from: {delta.baseName ?? delta.baseFilePath}{delta.baseFilePath ? ` (${delta.baseFilePath})` : ''}</p>
      )}
      {filePath && <p className="text-[11px] text-text-muted font-mono truncate">{filePath}</p>}
      {delta.changedProperties && delta.changedProperties.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {delta.changedProperties.map((p, i) => (
            <span key={i} className="text-[10px] font-mono text-text-secondary bg-void border border-border-subtle rounded px-1.5 py-0.5">{p}</span>
          ))}
        </div>
      )}
      {delta.continuity && (
        <p className="text-[11px] text-text-muted">
          continuity: <span className={delta.continuity.certainty === 'proven' ? 'text-node-function' : 'text-amber-400'}>{delta.continuity.certainty}</span> — {delta.continuity.reason}
        </p>
      )}
      {delta.continuityCandidates && delta.continuityCandidates.length > 0 && (
        <p className="text-[11px] text-amber-400/90">⚠ ambiguous match candidates: {delta.continuityCandidates.join(', ')}</p>
      )}
    </div>
  );
}

function RelationshipDeltaRow({ delta }: { delta: RelationshipDelta }) {
  const degraded = isDegraded(delta);
  return (
    <div className={`border rounded-lg px-3 py-2 text-sm space-y-1.5 ${degraded ? 'border-red-700/60 bg-red-950/20' : 'border-border-subtle bg-elevated/40'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <DeltaKindBadge kind={delta.kind} />
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: EDGE_COLORS[delta.edgeKind] ?? '#666' }} />
        <span className="text-xs font-mono text-text-muted">{delta.edgeKind}</span>
        {degraded && (
          <span className="text-[10px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 text-red-300 bg-red-900/30 border-red-700/50">
            ⚠ certainty degraded
          </span>
        )}
      </div>
      <p className="text-[11px] font-mono text-text-secondary truncate">
        {delta.sourceId} → {delta.targetId}
        {delta.callSiteId && <span className="text-text-muted"> · call site {delta.callSiteId}</span>}
      </p>
      {(delta.base || delta.head) && (
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1">
            <span className="text-text-muted">base:</span>
            <CertaintyPill certainty={delta.base?.certainty} />
            {delta.base?.strategy && <span className="text-text-muted font-mono">{delta.base.strategy}</span>}
          </div>
          <span className="text-text-muted">→</span>
          <div className="flex items-center gap-1">
            <span className="text-text-muted">head:</span>
            <CertaintyPill certainty={delta.head?.certainty} />
            {delta.head?.strategy && <span className="text-text-muted font-mono">{delta.head.strategy}</span>}
          </div>
        </div>
      )}
      {delta.changedFields && delta.changedFields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {delta.changedFields.map((f, i) => (
            <span key={i} className="text-[10px] font-mono text-text-secondary bg-void border border-border-subtle rounded px-1.5 py-0.5">{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function FlowDeltaRow({ delta }: { delta: FlowDelta }) {
  return (
    <div className="border border-border-subtle rounded-lg px-3 py-2 bg-elevated/40 text-sm space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <DeltaKindBadge kind={delta.kind === 'added' || delta.kind === 'removed' ? delta.kind : 'changed'} />
        <span className="text-xs font-mono text-text-muted">{delta.kind}</span>
        <span className="text-text-primary font-mono text-xs truncate">{delta.flowId}</span>
      </div>
      {delta.details && <p className="text-[11px] text-text-muted">{delta.details}</p>}
    </div>
  );
}
