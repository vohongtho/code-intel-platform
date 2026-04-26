import React, { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { Settings } from 'sigma/settings';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { useAppState } from '../../state/app-context';
import { NODE_COLORS, EDGE_COLORS, EDGE_ALPHA, withAlpha } from '../../graph/colors';
import { directNeighbors } from '../../graph/layout';
import type { NodeKind, EdgeKind } from '@code-intel/shared';

// ─── Dark node hover ──────────────────────────────────────────────────────────
function drawDarkNodeHover(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  const size = settings.labelSize;
  context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const PADDING = 3, RADIUS = 4;
  if (typeof data.label === 'string' && data.label.length > 0) {
    const textWidth = context.measureText(data.label).width;
    const boxWidth = Math.round(textWidth + PADDING * 2 + 6);
    const boxHeight = Math.round(size + PADDING * 2);
    const nodeRadius = Math.max(data.size, size / 2) + PADDING;
    const angleRadian = Math.asin(boxHeight / 2 / nodeRadius);
    const xDelta = Math.sqrt(Math.abs(nodeRadius ** 2 - (boxHeight / 2) ** 2));
    context.shadowOffsetX = 0; context.shadowOffsetY = 2; context.shadowBlur = 12;
    context.shadowColor = 'rgba(0,0,0,0.8)';
    context.fillStyle = '#0c101f'; context.strokeStyle = 'rgba(255,255,255,0.08)'; context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(data.x + xDelta, data.y + boxHeight / 2);
    context.lineTo(data.x + nodeRadius + boxWidth - RADIUS, data.y + boxHeight / 2);
    context.quadraticCurveTo(data.x + nodeRadius + boxWidth, data.y + boxHeight / 2, data.x + nodeRadius + boxWidth, data.y + boxHeight / 2 - RADIUS);
    context.lineTo(data.x + nodeRadius + boxWidth, data.y - boxHeight / 2 + RADIUS);
    context.quadraticCurveTo(data.x + nodeRadius + boxWidth, data.y - boxHeight / 2, data.x + nodeRadius + boxWidth - RADIUS, data.y - boxHeight / 2);
    context.lineTo(data.x + xDelta, data.y - boxHeight / 2);
    context.arc(data.x, data.y, nodeRadius, angleRadian, -angleRadian);
    context.closePath(); context.fill(); context.stroke();
    context.shadowOffsetX = 0; context.shadowOffsetY = 0; context.shadowBlur = 0;
    const nr = Math.max(data.size, size / 2) + PADDING;
    context.fillStyle = '#e2e8f0';
    context.fillText(data.label, data.x + nr + PADDING + 2, data.y + size / 2 - 1);
  } else {
    context.fillStyle = '#0c101f';
    context.beginPath(); context.arc(data.x, data.y, data.size + PADDING, 0, Math.PI * 2); context.closePath(); context.fill();
  }
}

// ─── Metadata stored on the graphology graph ──────────────────────────────────
interface GraphMeta { _degreeMap?: Map<string, number>; _topNThreshold?: number }

// ─── GraphView ────────────────────────────────────────────────────────────────
export function GraphView() {
  const { state, dispatch } = useAppState();

  // Always-fresh refs — avoids stale closures without recreating Sigma
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // The graphology graph lives for the component lifetime — rebuilt when data changes
  const graphRef = useRef<Graph & GraphMeta>(new Graph({ multi: false, type: 'directed' }) as Graph & GraphMeta);
  const sigmaRef = useRef<Sigma | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState({ nodes: 0, edges: 0 });

  // Track which data we've built the graph for
  const builtRef = useRef({ nodeCount: -1, edgeCount: -1 });

  // ── Step 1: Build graphology graph whenever node/edge data changes ──────────
  useEffect(() => {
    if (state.nodes.length === 0) return;
    if (
      builtRef.current.nodeCount === state.nodes.length &&
      builtRef.current.edgeCount === state.edges.length
    ) return;

    builtRef.current = { nodeCount: state.nodes.length, edgeCount: state.edges.length };
    const g = graphRef.current;
    g.clear();

    let i = 0;
    for (const node of state.nodes) {
      const angle = (i++ / Math.max(1, state.nodes.length)) * Math.PI * 2;
      const r = 200 + Math.random() * 300;
      try {
        g.addNode(node.id, {
          label: node.name,
          baseLabel: node.name,
          x: Math.cos(angle) * r + (Math.random() - 0.5) * 50,
          y: Math.sin(angle) * r + (Math.random() - 0.5) * 50,
          size: sizeForKind(node.kind as NodeKind),
          color: NODE_COLORS[node.kind as NodeKind] ?? '#6b7280',
          nodeKind: node.kind,
        });
      } catch { /* skip duplicate */ }
    }
    for (const edge of state.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target) || edge.source === edge.target) continue;
      try {
        const col = withAlpha(EDGE_COLORS[edge.kind] ?? '#4b5563', EDGE_ALPHA[edge.kind] ?? 0.25);
        g.addEdge(edge.source, edge.target, {
          color: col, baseColor: col,
          size: edge.kind === 'calls' ? 0.8 : edge.kind === 'imports' ? 0.5 : 0.4,
          type: 'arrow', edgeKind: edge.kind,
        });
      } catch { /* skip duplicate */ }
    }

    // ForceAtlas2 layout (synchronous)
    if (g.order > 0) {
      const s = forceAtlas2.inferSettings(g);
      forceAtlas2.assign(g, { iterations: g.order > 500 ? 80 : 150, settings: { ...s, gravity: 1, scalingRatio: 8, slowDown: 5, barnesHutOptimize: g.order > 200, adjustSizes: true } });
    }

    // Degree map for label threshold
    const degreeMap = new Map<string, number>();
    g.forEachNode((n) => degreeMap.set(n, g.degree(n)));
    const sortedDeg = [...degreeMap.values()].sort((a, b) => b - a);
    g._degreeMap = degreeMap;
    g._topNThreshold = sortedDeg[Math.min(30, sortedDeg.length - 1)] ?? 0;

    // If Sigma already exists, tell it to refresh with the new graph data
    if (sigmaRef.current) {
      applyNodeEdgeReducers(sigmaRef.current, g, stateRef.current, null, null);
      sigmaRef.current.refresh();
      let nc = 0, ec = 0;
      g.forEachNode((_n, a) => { if (!a.hidden) nc++; });
      g.forEachEdge((_e, a) => { if (!a.hidden) ec++; });
      setVisibleCount({ nodes: nc, edges: ec });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nodes, state.edges]);

  // ── Step 2: Mount Sigma exactly once (when container is ready) ──────────────
  useEffect(() => {
    if (!containerRef.current) return;
    if (sigmaRef.current) return; // already mounted

    const g = graphRef.current;
    const renderer = new Sigma(g, containerRef.current, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      defaultEdgeType: 'arrow',
      labelRenderedSizeThreshold: 4,
      labelFont: '"Inter", "SF Pro Display", system-ui, sans-serif',
      labelColor: { color: '#e2e8f0' },
      labelSize: 11,
      labelWeight: '600',
      defaultDrawNodeHover: drawDarkNodeHover,
    });

    sigmaRef.current = renderer;

    // Apply initial reducers
    applyNodeEdgeReducers(renderer, g, stateRef.current, null, null);
    renderer.refresh();

    // Guard: clickNode and clickStage both fire; clickNode must win
    let suppressNextStage = false;

    renderer.on('clickNode', ({ node }) => {
      suppressNextStage = true;
      const n = stateRef.current.nodes.find((nd) => nd.id === node);
      if (n) dispatchRef.current({ type: 'SELECT_NODE', node: n });
      setTimeout(() => { suppressNextStage = false; }, 50);
    });

    renderer.on('clickStage', () => {
      if (suppressNextStage) return;
      dispatchRef.current({ type: 'SELECT_NODE', node: null });
    });

    renderer.on('enterNode', ({ node }) => dispatchRef.current({ type: 'HOVER_NODE', nodeId: node }));
    renderer.on('leaveNode', () => dispatchRef.current({ type: 'HOVER_NODE', nodeId: null }));

    const onZoom = (e: Event) => {
      const factor = (e as CustomEvent<number>).detail;
      const cam = renderer.getCamera();
      if (factor === 0) cam.animatedReset();
      else cam.animate({ ratio: cam.getState().ratio * factor }, { duration: 200 });
    };
    window.addEventListener('graph-zoom', onZoom);

    return () => {
      window.removeEventListener('graph-zoom', onZoom);
      renderer.kill();
      sigmaRef.current = null;
    };
  // Mount once — no dependencies that could cause remount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 3: Apply filter/selection/hover reducers (no rebuild) ──────────────
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    applyNodeEdgeReducers(renderer, graphRef.current, state, state.hoveredNodeId, state.selectedNode?.id ?? null);
    renderer.refresh();

    let nc = 0, ec = 0;
    graphRef.current.forEachNode((_n, a) => { if (!a.hidden) nc++; });
    graphRef.current.forEachEdge((_e, a) => { if (!a.hidden) ec++; });
    setVisibleCount({ nodes: nc, edges: ec });
  }, [state.filters, state.hoveredNodeId, state.selectedNode]);

  // ── Step 4: Fly camera to selected node ─────────────────────────────────────
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer || !state.selectedNode) return;
    // Use getNodeDisplayData — it returns already-normalized (framed-graph) coordinates
    // that match the camera's coordinate space. Raw graphology attributes are NOT normalized.
    const displayData = renderer.getNodeDisplayData(state.selectedNode.id);
    if (!displayData) return;
    renderer.getCamera().animate(
      { x: displayData.x, y: displayData.y, ratio: Math.min(renderer.getCamera().getState().ratio, 0.5) },
      { duration: 400, easing: 'quadraticInOut' },
    );
  }, [state.selectedNode?.id]);

  return (
    <div className="relative w-full h-full bg-[#040812]">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-gray-950/90 backdrop-blur border border-gray-800/60 rounded-lg px-3 py-1.5 text-[10px] text-gray-400 font-mono pointer-events-none shadow-lg">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-gray-200">{visibleCount.nodes}</span>
        <span className="text-gray-600">nodes</span>
        <span className="text-gray-700">·</span>
        <span className="text-gray-200">{visibleCount.edges}</span>
        <span className="text-gray-600">edges</span>
      </div>
      <GraphLegend />
      <GraphControls />
    </div>
  );
}

// ─── Reducer logic (pure — no graph rebuild) ──────────────────────────────────
function applyNodeEdgeReducers(
  renderer: Sigma,
  g: Graph & GraphMeta,
  state: ReturnType<typeof useAppState>['state'],
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
) {
  const topNThreshold = g._topNThreshold ?? 0;
  const degreeMap = g._degreeMap ?? new Map<string, number>();
  const focusId = hoveredNodeId ?? selectedNodeId;
  const highlightSet = focusId ? directNeighbors(focusId, state.edges) : null;
  const hiddenKinds = state.filters.hiddenNodeKinds;
  const hiddenEdgeKinds = state.filters.hiddenEdgeKinds;

  let focusDepthSet: Set<string> | null = null;
  if (selectedNodeId && state.filters.focusDepth !== 'all' && typeof state.filters.focusDepth === 'number') {
    focusDepthSet = bfsNeighborhood(selectedNodeId, state.edges, state.filters.focusDepth);
  }

  renderer.setSetting('nodeReducer', (nodeId, attrs) => {
    const kind = attrs.nodeKind as NodeKind;
    if (hiddenKinds.has(kind)) return { ...attrs, hidden: true };
    if (focusDepthSet && !focusDepthSet.has(nodeId)) return { ...attrs, hidden: true };

    const baseColor = NODE_COLORS[kind] ?? attrs.color;
    const deg = degreeMap.get(nodeId) ?? 0;
    const baseLabel = deg >= topNThreshold ? (attrs.baseLabel ?? attrs.label) : '';

    if (!highlightSet) {
      return { ...attrs, hidden: false, color: baseColor, label: baseLabel };
    }

    if (highlightSet.has(nodeId)) {
      return {
        ...attrs, hidden: false, color: baseColor,
        label: attrs.baseLabel ?? attrs.label,
        zIndex: 2,
        size: nodeId === focusId ? (attrs.size ?? 5) * 1.8 : (attrs.size ?? 5) * 1.1,
        highlighted: nodeId === focusId,
      };
    }

    return {
      ...attrs, hidden: false,
      color: withAlpha(baseColor, 0.08),
      label: '',
      zIndex: 0,
      size: (attrs.size ?? 3) * 0.7,
    };
  });

  renderer.setSetting('edgeReducer', (edgeId, attrs) => {
    const edgeKind = attrs.edgeKind as EdgeKind;
    const ext = renderer.getGraph().extremities(edgeId);
    const srcKind = g.getNodeAttribute(ext[0], 'nodeKind') as NodeKind;
    const tgtKind = g.getNodeAttribute(ext[1], 'nodeKind') as NodeKind;

    if (hiddenEdgeKinds.has(edgeKind) || hiddenKinds.has(srcKind) || hiddenKinds.has(tgtKind)) {
      return { ...attrs, hidden: true };
    }
    if (focusDepthSet && (!focusDepthSet.has(ext[0]) || !focusDepthSet.has(ext[1]))) {
      return { ...attrs, hidden: true };
    }

    if (!highlightSet) {
      return { ...attrs, hidden: false, color: attrs.baseColor ?? attrs.color };
    }

    if (highlightSet.has(ext[0]) && highlightSet.has(ext[1])) {
      return { ...attrs, hidden: false, color: withAlpha(EDGE_COLORS[edgeKind] ?? '#9ca3af', 0.95), size: 1.5, zIndex: 1 };
    }
    return { ...attrs, hidden: false, color: '#0f172a30', size: 0.3, zIndex: 0 };
  });
}

// ─── BFS neighborhood ─────────────────────────────────────────────────────────
function bfsNeighborhood(startId: string, edges: { source: string; target: string }[], maxDepth: number): Set<string> {
  const result = new Set<string>([startId]);
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? (adj.set(e.source, []), adj.get(e.source)!)).push(e.target);
    (adj.get(e.target) ?? (adj.set(e.target, []), adj.get(e.target)!)).push(e.source);
  }
  const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const n of adj.get(id) ?? []) {
      if (!result.has(n)) { result.add(n); queue.push({ id: n, depth: depth + 1 }); }
    }
  }
  return result;
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function GraphLegend() {
  const [collapsed, setCollapsed] = React.useState(true);
  const topKinds: NodeKind[] = ['function', 'class', 'interface', 'file', 'method', 'enum'];
  return (
    <div className="absolute bottom-14 right-3 bg-gray-950/90 backdrop-blur border border-gray-800/60 rounded-lg shadow-xl overflow-hidden">
      <button onClick={() => setCollapsed(v => !v)} className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-200 w-full">
        <span>◉</span><span className="font-medium">Legend</span><span className="ml-auto">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2.5 space-y-1">
          {topKinds.map(k => (
            <div key={k} className="flex items-center gap-2 text-[10px] text-gray-400">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[k] }} />
              <span className="capitalize">{k}</span>
            </div>
          ))}
          <div className="border-t border-gray-800 mt-1 pt-1 space-y-1">
            {(['calls', 'imports', 'extends'] as EdgeKind[]).map(k => (
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

// ─── Controls ─────────────────────────────────────────────────────────────────
function GraphControls() {
  const zoom = (f: number) => window.dispatchEvent(new CustomEvent('graph-zoom', { detail: f }));
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1 bg-gray-950/90 backdrop-blur border border-gray-800/60 rounded-lg p-1 shadow-lg">
      <button className="w-7 h-7 text-gray-300 hover:bg-gray-800 hover:text-white rounded text-sm font-bold transition" onClick={() => zoom(0.7)} title="Zoom in">+</button>
      <button className="w-7 h-7 text-gray-300 hover:bg-gray-800 hover:text-white rounded text-sm font-bold transition" onClick={() => zoom(1.4)} title="Zoom out">−</button>
      <div className="h-px bg-gray-800 mx-1" />
      <button className="w-7 h-7 text-gray-400 hover:bg-gray-800 hover:text-white rounded text-xs transition" onClick={() => zoom(0)} title="Fit to view">⌖</button>
    </div>
  );
}

// ─── Node size by kind ────────────────────────────────────────────────────────
function sizeForKind(kind: NodeKind): number {
  const MAP: Partial<Record<NodeKind, number>> = {
    cluster: 9, class: 8, file: 7, module: 7, struct: 7,
    interface: 6, trait: 6, namespace: 6,
    function: 5, enum: 5, route: 5,
    method: 4, constructor: 4, type_alias: 4, flow: 4,
    constant: 3, variable: 3, property: 3, directory: 3,
  };
  return MAP[kind] ?? 3;
}
