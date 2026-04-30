import React, { useMemo } from 'react';
import { useAppState } from '../../state/app-context';
import { NODE_COLORS, EDGE_COLORS } from '../../graph/colors';
import type { NodeKind, EdgeKind } from 'code-intel-shared';
import type { FocusDepth } from '../../state/types';

const NODE_KIND_LABELS: Partial<Record<NodeKind, string>> = {
  directory: 'Folder',
  file: 'File',
  class: 'Class',
  function: 'Function',
  method: 'Method',
  variable: 'Variable',
  interface: 'Interface',
  module: 'Module',
  struct: 'Struct',
  enum: 'Enum',
  trait: 'Trait',
  namespace: 'Namespace',
  type_alias: 'Type Alias',
  constant: 'Constant',
  property: 'Property',
  constructor: 'Constructor',
  route: 'Route',
  cluster: 'Cluster',
  flow: 'Flow',
};

const EDGE_KIND_LABELS: Partial<Record<EdgeKind, string>> = {
  contains: 'Contains',
  calls: 'Calls',
  imports: 'Imports',
  extends: 'Extends',
  implements: 'Implements',
  has_member: 'Has Member',
  accesses: 'Accesses',
  overrides: 'Overrides',
  belongs_to: 'Belongs To',
  step_of: 'Step Of',
  handles: 'Handles',
};

const DEPTHS: FocusDepth[] = ['all', 1, 2, 3, 5];

export function SidebarFilters() {
  const { state, dispatch } = useAppState();

  const { nodeKindCounts, edgeKindCounts } = useMemo(() => {
    const n = new Map<NodeKind, number>();
    const e = new Map<EdgeKind, number>();
    for (const node of state.nodes) {
      n.set(node.kind, (n.get(node.kind) ?? 0) + 1);
    }
    for (const edge of state.edges) {
      e.set(edge.kind, (e.get(edge.kind) ?? 0) + 1);
    }
    return { nodeKindCounts: n, edgeKindCounts: e };
  }, [state.nodes, state.edges]);

  const nodeKinds = [...nodeKindCounts.entries()].sort((a, b) => b[1] - a[1]);
  const edgeKinds = [...edgeKindCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="overflow-y-auto h-full text-sm">
      {/* NODE TYPES */}
      <Section title="Node Types" subtitle="Toggle visibility of node types in the graph">
        <div className="space-y-1">
          {nodeKinds.map(([kind, count]) => {
            const hidden = state.filters.hiddenNodeKinds.has(kind);
            return (
              <button
                key={kind}
                onClick={() => dispatch({ type: 'TOGGLE_NODE_KIND', kind })}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800/60 text-left"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: NODE_COLORS[kind] ?? '#666', opacity: hidden ? 0.25 : 1 }}
                />
                <span className={`flex-1 text-xs ${hidden ? 'text-gray-600 line-through' : 'text-gray-200'}`}>
                  {NODE_KIND_LABELS[kind] ?? kind}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">{count}</span>
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                    hidden ? 'bg-gray-800 text-gray-600' : 'bg-blue-600/30 text-blue-300'
                  }`}
                >
                  {hidden ? '+' : '✓'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* EDGE TYPES */}
      <Section title="Edge Types" subtitle="Toggle visibility of relationship types">
        <div className="space-y-1">
          {edgeKinds.map(([kind, count]) => {
            const hidden = state.filters.hiddenEdgeKinds.has(kind);
            return (
              <button
                key={kind}
                onClick={() => dispatch({ type: 'TOGGLE_EDGE_KIND', kind })}
                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800/60 text-left"
              >
                <span
                  className="w-4 h-0.5 flex-shrink-0"
                  style={{ backgroundColor: EDGE_COLORS[kind] ?? '#666', opacity: hidden ? 0.25 : 1 }}
                />
                <span className={`flex-1 text-xs ${hidden ? 'text-gray-600 line-through' : 'text-gray-200'}`}>
                  {EDGE_KIND_LABELS[kind] ?? kind}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">{count}</span>
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                    hidden ? 'bg-gray-800 text-gray-600' : 'bg-blue-600/30 text-blue-300'
                  }`}
                >
                  {hidden ? '+' : '✓'}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* FOCUS DEPTH */}
      <Section title="Focus Depth" subtitle="Show nodes within N hops of selection">
        <div className="flex flex-wrap gap-1.5">
          {DEPTHS.map((d) => (
            <button
              key={String(d)}
              onClick={() => dispatch({ type: 'SET_FOCUS_DEPTH', depth: d })}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                state.filters.focusDepth === d
                  ? 'bg-cyan-500 text-gray-900'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
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

      {/* RESET */}
      <div className="px-3 pb-4">
        <button
          onClick={() => dispatch({ type: 'RESET_FILTERS' })}
          className="w-full px-2 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-3 border-b border-gray-800">
      <h3 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-0.5">
        {title}
      </h3>
      {subtitle && <p className="text-[10px] text-gray-600 mb-2">{subtitle}</p>}
      {children}
    </div>
  );
}
