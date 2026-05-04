export { createKnowledgeGraph } from './knowledge-graph.js';
export type { KnowledgeGraph } from './knowledge-graph.js';
export { generateNodeId, generateEdgeId } from './id-generator.js';
export { LazyKnowledgeGraph, isLazyGraph } from './lazy-knowledge-graph.js';
export type { LazyGraphExtensions } from './lazy-knowledge-graph.js';
export { CompactKnowledgeGraph, createCompactKnowledgeGraph } from './compact-knowledge-graph.js';
export { InternTable, internNode, internEdge, globalInternTable } from './intern-table.js';
