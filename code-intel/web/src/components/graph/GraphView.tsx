import React, { useEffect, useMemo, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { Settings } from 'sigma/settings';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useAppState } from '../../state/app-context';
import { NODE_COLORS, EDGE_COLORS, EDGE_ALPHA, withAlpha } from '../../graph/colors';
import { neighborhood, directNeighbors } from '../../graph/layout';
import type { NodeKind, EdgeKind } from '@code-intel/shared';

// Custom dark-themed node hover — overrides Sigma's default white fill
function drawDarkNodeHover(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;
  context.font = `${weight} ${size}px ${font}`;

  const PADDING = 3;
  const RADIUS = 4;

  if (typeof data.label === 'string' && data.label.length > 0) {
    const textWidth = context.measureText(data.label).width;
    const boxWidth = Math.round(textWidth + PADDING * 2 + 6);
    const boxHeight = Math.round(size + PADDING * 2);
    const nodeRadius = Math.max(data.size, size / 2) + PADDING;
    const angleRadian = Math.asin(boxHeight / 2 / nodeRadius);
    const xDelta = Math.sqrt(Math.abs(nodeRadius ** 2 - (boxHeight / 2) ** 2));

    // Shadow
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 2;
    context.shadowBlur = 12;
    context.shadowColor = 'rgba(0,0,0,0.8)';

    // Dark background pill
    context.fillStyle = '#0c101f';
    context.strokeStyle = 'rgba(255,255,255,0.08)';
    context.lineWidth = 0.8;

    context.beginPath();
    context.moveTo(data.x + xDelta, data.y + boxHeight / 2);
    context.lineTo(data.x + nodeRadius + boxWidth - RADIUS, data.y + boxHeight / 2);
    context.quadraticCurveTo(data.x + nodeRadius + boxWidth, data.y + boxHeight / 2, data.x + nodeRadius + boxWidth, data.y + boxHeight / 2 - RADIUS);
    context.lineTo(data.x + nodeRadius + boxWidth, data.y - boxHeight / 2 + RADIUS);
    context.quadraticCurveTo(data.x + nodeRadius + boxWidth, data.y - boxHeight / 2, data.x + nodeRadius + boxWidth - RADIUS, data.y - boxHeight / 2);
    context.lineTo(data.x + xDelta, data.y - boxHeight / 2);
    context.arc(data.x, data.y, nodeRadius, angleRadian, -angleRadian);
    context.closePath();
    context.fill();
    context.stroke();

    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.shadowBlur = 0;
  } else {
    context.fillStyle = '#0c101f';
    context.beginPath();
    context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2);
    context.closePath();
    context.fill();
  }

  // Label text
  if (typeof data.label === 'string' && data.label.length > 0) {
    const nodeRadius = Math.max(data.size, size / 2) + PADDING;
    context.fillStyle = '#e2e8f0';
    context.fillText(data.label, data.x + nodeRadius + PADDING + 2, data.y + size / 2 - 1);
  }
}

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const layoutRunningRef = useRef(false);
  const { state, dispatch } = useAppState();

  // Compute visible node set from filters + focus depth
  const visibleIds = useMemo(() => {
    const allowed = new Set<string>();
    for (const node of state.nodes) {
      if (state.filters.hiddenNodeKinds.has(node.kind)) continue;
      allowed.add(node.id);
    }
    if (
      state.selectedNode &&
      state.filters.focusDepth !== 'all' &&
      typeof state.filters.focusDepth === 'number'
    ) {
      const focus = neighborhood(state.selectedNode.id, state.edges, state.filters.focusDepth);
      for (const id of [...allowed]) if (!focus.has(id)) allowed.delete(id);
    }
    return allowed;
  }, [state.nodes, state.edges, state.filters, state.selectedNode]);

  // Build graphology graph
  const graph = useMemo(() => {
    const g = new Graph({ multi: false, type: 'directed' });
    let i = 0;
    for (const node of state.nodes) {
      if (!visibleIds.has(node.id)) continue;
      const angle = (i++ / Math.max(1, state.nodes.length)) * Math.PI * 2;
      const r = 200 + Math.random() * 300;
      try {
        g.addNode(node.id, {
          label: node.name,
          x: Math.cos(angle) * r + (Math.random() - 0.5) * 50,
          y: Math.sin(angle) * r + (Math.random() - 0.5) * 50,
          size: sizeForKind(node.kind),
          color: NODE_COLORS[node.kind] ?? '#6b7280',
          nodeKind: node.kind,
          filePath: node.filePath,
        });
      } catch {
        /* duplicate */
      }
    }
    for (const edge of state.edges) {
      if (state.filters.hiddenEdgeKinds.has(edge.kind)) continue;
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
      if (edge.source === edge.target) continue;
      try {
        const alpha = EDGE_ALPHA[edge.kind] ?? 0.25;
        g.addEdge(edge.source, edge.target, {
          color: withAlpha(EDGE_COLORS[edge.kind] ?? '#4b5563', alpha),
          size: edge.kind === 'calls' ? 0.8 : edge.kind === 'imports' ? 0.5 : 0.4,
          type: 'arrow',
          edgeKind: edge.kind,
        });
      } catch {
        /* duplicate */
      }
    }
    return g;
  }, [state.nodes, state.edges, state.filters.hiddenEdgeKinds, visibleIds]);

  // Run ForceAtlas2 layout
  useEffect(() => {
    if (graph.order === 0 || layoutRunningRef.current) return;
    layoutRunningRef.current = true;
    try {
      const settings = forceAtlas2.inferSettings(graph);
      forceAtlas2.assign(graph, {
        iterations: graph.order > 500 ? 80 : 150,
        settings: {
          ...settings,
          gravity: 1,
          scalingRatio: 8,
          slowDown: 5,
          barnesHutOptimize: graph.order > 200,
          adjustSizes: true,
        },
      });
    } finally {
      layoutRunningRef.current = false;
    }
  }, [graph]);

  // Build Sigma renderer
  useEffect(() => {
    if (!containerRef.current) return;
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    // Compute degree map for label threshold
    const degreeMap = new Map<string, number>();
    graph.forEachNode((n) => degreeMap.set(n, graph.degree(n)));
    const degrees = [...degreeMap.values()].sort((a, b) => b - a);
    const topNThreshold = degrees[Math.min(30, degrees.length - 1)] ?? 0;

    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      defaultEdgeType: 'arrow',
      labelRenderedSizeThreshold: 4,
      labelFont: '"Inter", "SF Pro Display", system-ui, sans-serif',
      labelColor: { color: '#e2e8f0' },
      labelSize: 11,
      labelWeight: '600',
      defaultDrawNodeHover: drawDarkNodeHover,
      // Only render labels for top-degree nodes initially
      nodeReducer: (nodeId, attrs) => {
        const deg = degreeMap.get(nodeId) ?? 0;
        return {
          ...attrs,
          label: deg >= topNThreshold ? attrs.label : '',
        };
      },
    });

    renderer.on('clickNode', ({ node }) => {
      const n = state.nodes.find((nd) => nd.id === node);
      if (n) dispatch({ type: 'SELECT_NODE', node: n });
    });
    renderer.on('enterNode', ({ node }) => dispatch({ type: 'HOVER_NODE', nodeId: node }));
    renderer.on('leaveNode', () => dispatch({ type: 'HOVER_NODE', nodeId: null }));
    renderer.on('clickStage', () => dispatch({ type: 'SELECT_NODE', node: null }));

    sigmaRef.current = renderer;

    const onZoom = (e: Event) => {
      const factor = (e as CustomEvent<number>).detail;
      const cam = renderer.getCamera();
      if (factor === 0) {
        cam.animatedReset();
      } else {
        cam.animate({ ratio: cam.getState().ratio * factor }, { duration: 200 });
      }
    };
    window.addEventListener('graph-zoom', onZoom);

    return () => {
      window.removeEventListener('graph-zoom', onZoom);
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [graph]);

  // Fly camera to selected node
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer || !state.selectedNode) return;
    const nodeId = state.selectedNode.id;
    if (!graph.hasNode(nodeId)) return;
    const { x, y } = graph.getNodeAttributes(nodeId) as { x: number; y: number };
    const cam = renderer.getCamera();
    cam.animate(
      { x, y, ratio: Math.min(cam.getState().ratio, 0.5) },
      { duration: 400, easing: 'quadraticInOut' },
    );
  }, [state.selectedNode?.id]);

  // Apply highlight reducers when selection/hover changes
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const hoverId = state.hoveredNodeId;
    const selectedId = state.selectedNode?.id ?? null;
    const focusId = hoverId ?? selectedId;
    const highlightSet = focusId ? directNeighbors(focusId, state.edges) : null;

    renderer.setSetting('nodeReducer', (nodeId, attrs) => {
      const data = { ...attrs };
      if (highlightSet) {
        if (highlightSet.has(nodeId)) {
          data.zIndex = 2;
          data.label = graph.getNodeAttribute(nodeId, 'label') || attrs.label;
          if (nodeId === focusId) {
            data.size = (attrs.size ?? 5) * 1.8;
            data.highlighted = true;
            data.color = attrs.color;
          } else {
            data.size = (attrs.size ?? 5) * 1.1;
          }
        } else {
          data.color = '#0f172a';
          data.label = '';
          data.zIndex = 0;
        }
      }
      return data;
    });
    renderer.setSetting('edgeReducer', (edgeId, attrs) => {
      const data = { ...attrs };
      if (highlightSet) {
        const ext = renderer.getGraph().extremities(edgeId);
        if (highlightSet.has(ext[0]) && highlightSet.has(ext[1])) {
          data.color = withAlpha(
            EDGE_COLORS[(attrs.edgeKind as EdgeKind) ?? 'calls'] ?? '#9ca3af',
            0.95,
          );
          data.size = 1.5;
          data.zIndex = 1;
        } else {
          data.color = '#0f172a40';
          data.size = 0.3;
          data.zIndex = 0;
        }
      }
      return data;
    });
    renderer.refresh();
  }, [state.hoveredNodeId, state.selectedNode, state.edges]);

  return (
    <div className="relative w-full h-full bg-[#040812]">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Overlay info bar */}
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-gray-950/90 backdrop-blur border border-gray-800/60 rounded-lg px-3 py-1.5 text-[10px] text-gray-400 font-mono pointer-events-none shadow-lg">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-gray-200">{graph.order}</span>
        <span className="text-gray-600">nodes</span>
        <span className="text-gray-700">·</span>
        <span className="text-gray-200">{graph.size}</span>
        <span className="text-gray-600">edges</span>
      </div>
      {/* Legend */}
      <GraphLegend />
      <GraphControls />
    </div>
  );
}

function GraphLegend() {
  const [collapsed, setCollapsed] = React.useState(true);
  const topKinds: NodeKind[] = ['function', 'class', 'interface', 'file', 'method', 'enum'];
  return (
    <div className="absolute bottom-14 right-3 bg-gray-950/90 backdrop-blur border border-gray-800/60 rounded-lg shadow-xl overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-200 w-full"
      >
        <span>◉</span>
        <span className="font-medium">Legend</span>
        <span className="ml-auto">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2.5 space-y-1">
          {topKinds.map((k) => (
            <div key={k} className="flex items-center gap-2 text-[10px] text-gray-400">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: NODE_COLORS[k] }}
              />
              <span className="capitalize">{k}</span>
            </div>
          ))}
          <div className="border-t border-gray-800 mt-1 pt-1 space-y-1">
            {(['calls', 'imports', 'extends'] as EdgeKind[]).map((k) => (
              <div key={k} className="flex items-center gap-2 text-[10px] text-gray-400">
                <span className="w-4 h-px flex-shrink-0" style={{ backgroundColor: EDGE_COLORS[k] }} />
                <span>{k}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GraphControls() {
  const zoom = (factor: number) => {
    window.dispatchEvent(new CustomEvent('graph-zoom', { detail: factor }));
  };
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1 bg-gray-950/90 backdrop-blur border border-gray-800/60 rounded-lg p-1 shadow-lg">
      <button
        className="w-7 h-7 text-gray-300 hover:bg-gray-800 hover:text-white rounded text-sm font-bold transition"
        onClick={() => zoom(0.7)}
        title="Zoom in"
      >
        +
      </button>
      <button
        className="w-7 h-7 text-gray-300 hover:bg-gray-800 hover:text-white rounded text-sm font-bold transition"
        onClick={() => zoom(1.4)}
        title="Zoom out"
      >
        −
      </button>
      <div className="h-px bg-gray-800 mx-1" />
      <button
        className="w-7 h-7 text-gray-400 hover:bg-gray-800 hover:text-white rounded text-xs transition"
        onClick={() => zoom(0)}
        title="Fit to view"
      >
        ⌖
      </button>
    </div>
  );
}

function sizeForKind(kind: NodeKind): number {
  switch (kind) {
    case 'function':    return 5;   // primary logic
    case 'file':        return 7;   // container
    case 'class':       return 8;   // structural
    case 'interface':   return 6;   // abstract
    case 'enum':        return 5;   // structured constants
    case 'constant':    return 3;   // small/subtle
    case 'type_alias':  return 4;   // rare highlight
    case 'flow':        return 4;   // execution path
    case 'method':      return 4;
    case 'constructor': return 4;
    case 'struct':      return 7;
    case 'trait':       return 6;
    case 'variable':    return 3;
    case 'property':    return 3;
    case 'namespace':   return 6;
    case 'module':      return 7;
    case 'route':       return 5;
    case 'cluster':     return 9;
    case 'directory':   return 3;
    default:            return 3;
  }
}
