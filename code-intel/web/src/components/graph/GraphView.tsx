import React, { useEffect, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import type { Settings } from 'sigma/settings';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { useAppState } from '../../state/app-context';
import { NODE_COLORS, EDGE_COLORS, EDGE_ALPHA, withAlpha } from '../../graph/colors';
import { directNeighbors } from '../../graph/layout';
import type { NodeKind, EdgeKind, CodeEdge } from 'code-intel-shared';

// ── Dark node hover — pill drawn ABOVE the node ───────────────────────────────
function drawDarkNodeHover(
  context: CanvasRenderingContext2D,
  data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>,
  settings: Settings,
): void {
  const label = data.label;
  if (!label) return;

  const size = settings.labelSize ?? 11;
  const font = settings.labelFont ?? 'Outfit, system-ui, sans-serif';
  const weight = settings.labelWeight ?? '600';

  context.font = `${weight} ${size}px ${font}`;
  const textWidth = context.measureText(label).width;

  const nodeSize = data.size ?? 8;
  const x = data.x;
  const y = data.y - nodeSize - 10; // above the node
  const padX = 8;
  const padY = 5;
  const h = size + padY * 2;
  const w = textWidth + padX * 2;
  const r = 4;

  // Dark background pill
  context.fillStyle = '#0a0a10';
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 2;
  context.shadowBlur = 12;
  context.shadowColor = 'rgba(0,0,0,0.9)';
  context.beginPath();
  context.roundRect(x - w / 2, y - h / 2, w, h, r);
  context.fill();

  // Border matching node color
  context.shadowBlur = 0;
  context.strokeStyle = data.color ?? '#7c3aed';
  context.lineWidth = 1.5;
  context.stroke();

  // Label text
  context.fillStyle = '#f5f5f7';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, x, y);

  // Glow ring around the node
  context.beginPath();
  context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
  context.strokeStyle = data.color ?? '#7c3aed';
  context.lineWidth = 2;
  context.globalAlpha = 0.5;
  context.stroke();
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

// ── Helpers: color mixing ─────────────────────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 100, g: 100, b: 100 };
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function dimColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const bg = { r: 10, g: 10, b: 16 }; // #0a0a10 — void bg
  return rgbToHex(bg.r + (rgb.r - bg.r) * amount, bg.g + (rgb.g - bg.g) * amount, bg.b + (rgb.b - bg.b) * amount);
}

interface GraphMeta { _degreeMap?: Map<string, number>; _topNThreshold?: number }

// ── FA2 settings ──────────────────────────────────────────────────────────────
const FA2_SETTINGS = (nodeCount: number) => ({
  gravity: nodeCount < 500 ? 0.8 : nodeCount < 2000 ? 0.5 : 0.3,
  scalingRatio: nodeCount < 500 ? 15 : nodeCount < 2000 ? 30 : 60,
  slowDown: nodeCount < 500 ? 1 : nodeCount < 2000 ? 2 : 3,
  barnesHutOptimize: nodeCount > 200,
  barnesHutTheta: nodeCount >= 2000 ? 0.8 : 0.6,
  strongGravityMode: false,
  outboundAttractionDistribution: true,
  linLogMode: false,
  adjustSizes: true,
  edgeWeightInfluence: 1,
});

const LAYOUT_DURATION = (nodeCount: number): number => {
  if (nodeCount > 10000) return 45000;
  if (nodeCount > 5000) return 35000;
  if (nodeCount > 2000) return 30000;
  if (nodeCount > 1000) return 25000;
  return 20000;
};

// ── Hierarchy-based initial positions (golden angle) ─────────────────────────
// Children start near their parent → FA2 converges quickly and smoothly
function buildInitialPositions(
  nodes: { id: string; kind: string }[],
  edges: CodeEdge[],
): Map<string, { x: number; y: number }> {
  const childToParent = new Map<string, string>();
  const parentToChildren = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === 'contains' || e.kind === 'has_member' || e.kind === 'belongs_to') {
      childToParent.set(e.target, e.source);
      if (!parentToChildren.has(e.source)) parentToChildren.set(e.source, []);
      parentToChildren.get(e.source)!.push(e.target);
    }
  }

  const nodeCount = nodes.length;
  const structuralKinds = new Set<string>(['file', 'module', 'namespace', 'class', 'struct', 'cluster', 'directory']);
  const structuralNodes = nodes.filter(n => structuralKinds.has(n.kind));
  const contentNodes = nodes.filter(n => !structuralKinds.has(n.kind));

  const structuralSpread = Math.sqrt(nodeCount) * 40;
  const childJitter = Math.sqrt(nodeCount) * 3;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const positions = new Map<string, { x: number; y: number }>();

  // Structural nodes spread wide via golden angle
  structuralNodes.forEach((node, index) => {
    const angle = index * goldenAngle;
    const radius = structuralSpread * Math.sqrt((index + 1) / Math.max(structuralNodes.length, 1));
    const jitter = structuralSpread * 0.15;
    positions.set(node.id, {
      x: radius * Math.cos(angle) + (Math.random() - 0.5) * jitter,
      y: radius * Math.sin(angle) + (Math.random() - 0.5) * jitter,
    });
  });

  const placeNode = (nodeId: string) => {
    if (positions.has(nodeId)) return;
    const parentPos = positions.get(childToParent.get(nodeId) ?? '');
    if (parentPos) {
      positions.set(nodeId, {
        x: parentPos.x + (Math.random() - 0.5) * childJitter,
        y: parentPos.y + (Math.random() - 0.5) * childJitter,
      });
    } else {
      positions.set(nodeId, {
        x: (Math.random() - 0.5) * structuralSpread * 0.5,
        y: (Math.random() - 0.5) * structuralSpread * 0.5,
      });
    }
  };

  // BFS from structural nodes to place children
  const queue: string[] = structuralNodes.map(n => n.id);
  const visited = new Set<string>(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const childId of parentToChildren.get(id) ?? []) {
      if (!visited.has(childId)) {
        visited.add(childId);
        placeNode(childId);
        queue.push(childId);
      }
    }
  }

  // Remaining content nodes (functions etc. not reached via hierarchy)
  for (const node of contentNodes) placeNode(node.id);
  // Any truly orphaned nodes
  for (const node of nodes) placeNode(node.id);

  return positions;
}

// ── Node size + mass by kind ──────────────────────────────────────────────────
function sizeForKind(kind: NodeKind): number {
  const MAP: Partial<Record<NodeKind, number>> = {
    cluster: 12, directory: 10,
    module: 10, namespace: 10,
    file: 7, class: 8, struct: 8, interface: 7, trait: 7,
    function: 4, enum: 5, route: 5,
    method: 3, constructor: 3, type_alias: 3, flow: 3,
    constant: 2, variable: 2, property: 2,
  };
  return MAP[kind] ?? 3;
}

function massForKind(kind: NodeKind): number {
  const MAP: Partial<Record<NodeKind, number>> = {
    cluster: 50, directory: 20, module: 20, namespace: 15,
    file: 10, class: 8, struct: 8, interface: 6, trait: 6,
    function: 2, method: 2, enum: 3, route: 3,
    constructor: 1, type_alias: 1, constant: 1, variable: 1, property: 1,
  };
  return MAP[kind] ?? 1;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function GraphView() {
  const { state, dispatch } = useAppState();

  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const graphRef = useRef<Graph & GraphMeta>(new Graph({ multi: false, type: 'directed' }) as Graph & GraphMeta);
  const sigmaRef = useRef<Sigma | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<InstanceType<typeof FA2Layout> | null>(null);
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState({ nodes: 0, edges: 0 });
  const [isLayoutRunning, setIsLayoutRunning] = useState(false);

  const builtRef = useRef({ nodeCount: -1, edgeCount: -1 });

  const stopLayout = () => {
    if (layoutTimerRef.current) { clearTimeout(layoutTimerRef.current); layoutTimerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (layoutRef.current) { layoutRef.current.stop(); layoutRef.current = null; }
    setIsLayoutRunning(false);
  };

  const startLayout = (g: Graph & GraphMeta) => {
    stopLayout();
    if (g.order === 0) return;
    const inferred = forceAtlas2.inferSettings(g);
    const layout = new FA2Layout(g, { settings: { ...inferred, ...FA2_SETTINGS(g.order) } });
    layoutRef.current = layout;
    layout.start();
    setIsLayoutRunning(true);

    // RAF loop: Sigma needs an explicit refresh call each frame to pick up
    // position updates from the FA2 web worker
    const tick = () => {
      if (layoutRef.current) {
        sigmaRef.current?.refresh();
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    layoutTimerRef.current = setTimeout(() => {
      layout.stop();
      layoutRef.current = null;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setIsLayoutRunning(false);
      sigmaRef.current?.refresh();
    }, LAYOUT_DURATION(g.order));
  };

  // ── Step 1: build graphology graph when data changes ─────────────────────────
  useEffect(() => {
    if (state.nodes.length === 0) return;
    if (
      builtRef.current.nodeCount === state.nodes.length &&
      builtRef.current.edgeCount === state.edges.length
    ) return;

    builtRef.current = { nodeCount: state.nodes.length, edgeCount: state.edges.length };
    const g = graphRef.current;

    stopLayout();
    g.clear();

    // Hierarchy-based initial positions so FA2 converges quickly and smoothly
    const positions = buildInitialPositions(state.nodes, state.edges);

    for (const node of state.nodes) {
      const pos = positions.get(node.id) ?? { x: (Math.random() - 0.5) * 500, y: (Math.random() - 0.5) * 500 };
      try {
        g.addNode(node.id, {
          label: node.name,
          baseLabel: node.name,
          x: pos.x,
          y: pos.y,
          size: sizeForKind(node.kind as NodeKind),
          color: NODE_COLORS[node.kind as NodeKind] ?? '#6b7280',
          nodeKind: node.kind,
          mass: massForKind(node.kind as NodeKind),
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

    const degreeMap = new Map<string, number>();
    g.forEachNode((n) => degreeMap.set(n, g.degree(n)));
    const sortedDeg = [...degreeMap.values()].sort((a, b) => b - a);
    g._degreeMap = degreeMap;
    g._topNThreshold = sortedDeg[Math.min(30, sortedDeg.length - 1)] ?? 0;

    if (sigmaRef.current) {
      applyNodeEdgeReducers(sigmaRef.current, g, stateRef.current, null, null);
      sigmaRef.current.refresh();
      sigmaRef.current.getCamera().animatedReset({ duration: 500 });
      let nc = 0, ec = 0;
      g.forEachNode((_n, a) => { if (!a.hidden) nc++; });
      g.forEachEdge((_e, a) => { if (!a.hidden) ec++; });
      setVisibleCount({ nodes: nc, edges: ec });
    }

    startLayout(g);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nodes, state.edges]);

  // ── Step 2: mount Sigma once ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || sigmaRef.current) return;

    const g = graphRef.current;
    const renderer = new Sigma(g, containerRef.current, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      defaultEdgeType: 'arrow',
      labelRenderedSizeThreshold: 4,
      labelFont: '"Outfit", "Inter", system-ui, sans-serif',
      labelColor: { color: '#e4e4ed' },
      labelSize: 11,
      labelWeight: '600',
      labelDensity: 0.15,
      labelGridCellSize: 80,
      defaultDrawNodeHover: drawDarkNodeHover,
      // Performance + visual quality
      hideEdgesOnMove: true,   // Huge win: edges hidden while layout runs → fluid animation
      zIndex: true,
      minCameraRatio: 0.002,
      maxCameraRatio: 50,
    });

    sigmaRef.current = renderer;
    applyNodeEdgeReducers(renderer, g, stateRef.current, null, null);
    renderer.refresh();

    // Update cursor to indicate interactive canvas
    if (containerRef.current) containerRef.current.style.cursor = 'grab';

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

    renderer.on('enterNode', ({ node }) => {
      dispatchRef.current({ type: 'HOVER_NODE', nodeId: node });
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    renderer.on('leaveNode', () => {
      dispatchRef.current({ type: 'HOVER_NODE', nodeId: null });
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    const onZoom = (e: Event) => {
      const factor = (e as CustomEvent<number>).detail;
      const cam = renderer.getCamera();
      if (factor === 0) cam.animatedReset();
      else cam.animate({ ratio: cam.getState().ratio * factor }, { duration: 200 });
    };
    window.addEventListener('graph-zoom', onZoom);

    return () => {
      window.removeEventListener('graph-zoom', onZoom);
      // Stop layout worker + RAF loop before killing Sigma
      if (layoutTimerRef.current) { clearTimeout(layoutTimerRef.current); layoutTimerRef.current = null; }
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (layoutRef.current) { layoutRef.current.stop(); layoutRef.current = null; }
      renderer.kill();
      sigmaRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 3: apply filters / selection reducers ────────────────────────────────
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

  // ── Step 4: fly to selected node ─────────────────────────────────────────────
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer || !state.selectedNode) return;
    const displayData = renderer.getNodeDisplayData(state.selectedNode.id);
    if (!displayData) return;
    renderer.getCamera().animate(
      { x: displayData.x, y: displayData.y, ratio: Math.min(renderer.getCamera().getState().ratio, 0.5) },
      { duration: 400, easing: 'quadraticInOut' },
    );
  }, [state.selectedNode?.id]);

  return (
    <div className="relative w-full h-full bg-void">
      {/* Subtle background gradient */}
      <div className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(circle at 50% 50%, rgba(124,58,237,0.04) 0%, transparent 70%)',
      }} />

      {/* Sigma container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Visible count badge */}
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-deep/90 backdrop-blur border border-border-subtle rounded-lg px-3 py-1.5 text-[10px] text-text-muted font-mono pointer-events-none shadow-lg">
        <span className="w-1.5 h-1.5 rounded-full bg-node-function animate-pulse" />
        <span className="text-text-secondary">{visibleCount.nodes}</span>
        <span className="text-text-muted">nodes</span>
        <span className="text-border-default">·</span>
        <span className="text-text-secondary">{visibleCount.edges}</span>
        <span className="text-text-muted">edges</span>
      </div>

      {/* Layout running indicator — centered bottom, matches ref-use style */}
      {isLayoutRunning && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-accent/20 border border-accent/30 rounded-full px-3 py-1.5 backdrop-blur-sm pointer-events-none animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
          <span className="text-xs font-medium text-accent">Layout optimizing…</span>
        </div>
      )}

      <GraphLegend />
      <GraphControls
        isLayoutRunning={isLayoutRunning}
        onToggleLayout={() => {
          if (isLayoutRunning) stopLayout();
          else startLayout(graphRef.current);
        }}
      />
    </div>
  );
}

// ── Reducer logic ─────────────────────────────────────────────────────────────
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

    if (!highlightSet) return { ...attrs, hidden: false, color: baseColor, label: baseLabel };

    if (highlightSet.has(nodeId)) {
      return {
        ...attrs, hidden: false, color: baseColor,
        label: attrs.baseLabel ?? attrs.label,
        zIndex: 2,
        size: nodeId === focusId ? (attrs.size ?? 5) * 1.8 : (attrs.size ?? 5) * 1.1,
        highlighted: nodeId === focusId,
      };
    }
    return { ...attrs, hidden: false, color: dimColor(baseColor, 0.12), label: '', zIndex: 0, size: (attrs.size ?? 3) * 0.5 };
  });

  renderer.setSetting('edgeReducer', (edgeId, attrs) => {
    const edgeKind = attrs.edgeKind as EdgeKind;
    const ext = renderer.getGraph().extremities(edgeId);
    const srcKind = g.getNodeAttribute(ext[0], 'nodeKind') as NodeKind;
    const tgtKind = g.getNodeAttribute(ext[1], 'nodeKind') as NodeKind;

    if (hiddenEdgeKinds.has(edgeKind) || hiddenKinds.has(srcKind) || hiddenKinds.has(tgtKind)) return { ...attrs, hidden: true };
    if (focusDepthSet && (!focusDepthSet.has(ext[0]) || !focusDepthSet.has(ext[1]))) return { ...attrs, hidden: true };

    if (!highlightSet) return { ...attrs, hidden: false, color: attrs.baseColor ?? attrs.color };

    if (highlightSet.has(ext[0]) && highlightSet.has(ext[1])) {
      return { ...attrs, hidden: false, color: withAlpha(EDGE_COLORS[edgeKind] ?? '#9ca3af', 0.95), size: 1.5, zIndex: 1 };
    }
    return { ...attrs, hidden: false, color: '#1e1e2a40', size: 0.3, zIndex: 0 };
  });
}

// ── BFS neighborhood ──────────────────────────────────────────────────────────
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

// ── Legend ────────────────────────────────────────────────────────────────────
function GraphLegend() {
  const [collapsed, setCollapsed] = React.useState(true);
  const topKinds: NodeKind[] = ['function', 'class', 'interface', 'file', 'method', 'enum'];
  return (
    <div className="absolute bottom-3 right-14 bg-deep/90 backdrop-blur border border-border-subtle rounded-lg shadow-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-text-muted hover:text-text-secondary w-full transition"
      >
        <span>◉</span>
        <span className="font-medium">Legend</span>
        <span className="ml-auto">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2.5 space-y-1">
          {topKinds.map(k => (
            <div key={k} className="flex items-center gap-2 text-[10px] text-text-muted">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[k] }} />
              <span className="capitalize">{k}</span>
            </div>
          ))}
          <div className="border-t border-border-subtle mt-1 pt-1 space-y-1">
            {(['calls', 'imports', 'extends'] as EdgeKind[]).map(k => (
              <div key={k} className="flex items-center gap-2 text-[10px] text-text-muted">
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

// ── Controls ──────────────────────────────────────────────────────────────────
function GraphControls({ isLayoutRunning, onToggleLayout }: { isLayoutRunning: boolean; onToggleLayout: () => void }) {
  const zoom = (f: number) => window.dispatchEvent(new CustomEvent('graph-zoom', { detail: f }));
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1 bg-deep/90 backdrop-blur border border-border-subtle rounded-lg p-1 shadow-lg">
      <button
        className="w-8 h-8 flex items-center justify-center text-text-secondary hover:bg-hover hover:text-text-primary rounded text-sm font-bold transition"
        onClick={() => zoom(0.7)} title="Zoom in"
      >+</button>
      <button
        className="w-8 h-8 flex items-center justify-center text-text-secondary hover:bg-hover hover:text-text-primary rounded text-sm font-bold transition"
        onClick={() => zoom(1.4)} title="Zoom out"
      >−</button>
      <div className="h-px bg-border-subtle mx-1" />
      <button
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:bg-hover hover:text-text-primary rounded text-xs transition"
        onClick={() => zoom(0)} title="Fit to view"
      >⌖</button>
      <div className="h-px bg-border-subtle mx-1" />
      <button
        className={`w-8 h-8 flex items-center justify-center rounded text-xs transition ${
          isLayoutRunning
            ? 'text-accent bg-accent/10 border border-accent/40 animate-pulse'
            : 'text-text-muted hover:bg-hover hover:text-text-primary border border-transparent'
        }`}
        onClick={onToggleLayout}
        title={isLayoutRunning ? 'Stop layout' : 'Restart layout'}
      >{isLayoutRunning ? '⏸' : '⏵'}</button>
    </div>
  );
}
