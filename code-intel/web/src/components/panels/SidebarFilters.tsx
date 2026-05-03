import React, { useMemo } from 'react';
import { useAppState } from '../../state/app-context';
import { NODE_COLORS, EDGE_COLORS } from '../../graph/colors';
import type { NodeKind, EdgeKind } from 'code-intel-shared';
import type { FocusDepth } from '../../state/types';

const NODE_KIND_LABELS: Partial<Record<NodeKind, string>> = {
  directory:   'Folder',
  file:        'File',
  class:       'Class',
  function:    'Function',
  method:      'Method',
  variable:    'Variable',
  interface:   'Interface',
  module:      'Module',
  struct:      'Struct',
  enum:        'Enum',
  trait:       'Trait',
  namespace:   'Namespace',
  type_alias:  'Type Alias',
  constant:    'Constant',
  property:    'Property',
  constructor: 'Constructor',
  route:       'Route',
  cluster:     'Cluster',
  flow:        'Flow',
};

const EDGE_KIND_LABELS: Partial<Record<EdgeKind, string>> = {
  contains:   'Contains',
  calls:      'Calls',
  imports:    'Imports',
  extends:    'Extends',
  implements: 'Implements',
  has_member: 'Has Member',
  accesses:   'Accesses',
  overrides:  'Overrides',
  belongs_to: 'Belongs To',
  step_of:    'Step Of',
  handles:    'Handles',
};

const DEPTHS: FocusDepth[] = ['all', 1, 2, 3, 5];

export function SidebarFilters() {
  const { state, dispatch } = useAppState();

  const { nodeKindCounts, edgeKindCounts } = useMemo(() => {
    const n = new Map<NodeKind, number>();
    const e = new Map<EdgeKind, number>();
    for (const node of state.nodes) n.set(node.kind, (n.get(node.kind) ?? 0) + 1);
    for (const edge of state.edges) e.set(edge.kind, (e.get(edge.kind) ?? 0) + 1);
    return { nodeKindCounts: n, edgeKindCounts: e };
  }, [state.nodes, state.edges]);

  const nodeKinds = [...nodeKindCounts.entries()].sort((a, b) => b[1] - a[1]);
  const edgeKinds = [...edgeKindCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="overflow-y-auto scrollbar-thin h-full text-sm">

      {/* Node Types */}
      <Section title="Node Types" subtitle="Toggle visibility in the graph">
        <div className="space-y-0.5">
          {nodeKinds.map(([kind, count]) => {
            const hidden = state.filters.hiddenNodeKinds.has(kind);
            const color = NODE_COLORS[kind] ?? '#6b7280';
            return (
              <button
                key={kind}
                onClick={() => dispatch({ type: 'TOGGLE_NODE_KIND', kind })}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-hover text-left transition"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 transition-opacity"
                  style={{ backgroundColor: color, opacity: hidden ? 0.2 : 1 }}
                />
                <span className={`flex-1 text-xs ${hidden ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
                  {NODE_KIND_LABELS[kind] ?? kind}
                </span>
                <span className="text-[10px] text-text-muted font-mono">{count}</span>
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                  hidden ? 'bg-elevated text-text-muted' : 'bg-accent/20 text-accent'
                }`}>
                  {hidden ? '+' : '✓'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Edge Types */}
      <Section title="Edge Types" subtitle="Toggle visibility of relationships">
        <div className="space-y-0.5">
          {edgeKinds.map(([kind, count]) => {
            const hidden = state.filters.hiddenEdgeKinds.has(kind);
            const color = EDGE_COLORS[kind] ?? '#6b7280';
            return (
              <button
                key={kind}
                onClick={() => dispatch({ type: 'TOGGLE_EDGE_KIND', kind })}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-hover text-left transition"
              >
                <span
                  className="w-4 h-0.5 flex-shrink-0 transition-opacity"
                  style={{ backgroundColor: color, opacity: hidden ? 0.2 : 1 }}
                />
                <span className={`flex-1 text-xs ${hidden ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
                  {EDGE_KIND_LABELS[kind] ?? kind}
                </span>
                <span className="text-[10px] text-text-muted font-mono">{count}</span>
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                  hidden ? 'bg-elevated text-text-muted' : 'bg-accent/20 text-accent'
                }`}>
                  {hidden ? '+' : '✓'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Focus Depth */}
      <Section title="Focus Depth" subtitle="Show nodes within N hops of selection">
        <div className="flex flex-wrap gap-1.5">
          {DEPTHS.map((d) => (
            <button
              key={String(d)}
              onClick={() => dispatch({ type: 'SET_FOCUS_DEPTH', depth: d })}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                state.filters.focusDepth === d
                  ? 'bg-accent text-white shadow-glow'
                  : 'bg-elevated text-text-muted hover:bg-hover hover:text-text-secondary'
              }`}
            >
              {d === 'all' ? 'All' : `${d} hop${d === 1 ? '' : 's'}`}
            </button>
          ))}
        </div>
        {!state.selectedNode && state.filters.focusDepth !== 'all' && (
          <p className="text-[10px] text-amber-400 mt-2">Select a node to apply focus depth.</p>
        )}
      </Section>

      {/* Reset */}
      <div className="px-3 pb-4">
        <button
          onClick={() => dispatch({ type: 'RESET_FILTERS' })}
          className="w-full px-2 py-1.5 text-xs bg-elevated hover:bg-hover text-text-secondary rounded transition"
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b border-border-subtle">
      <h3 className="text-[10px] font-bold tracking-wider text-text-muted uppercase mb-0.5">{title}</h3>
      {subtitle && <p className="text-[10px] text-text-muted/60 mb-2">{subtitle}</p>}
      {children}
    </div>
  );
}
