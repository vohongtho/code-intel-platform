/**
 * pdg/build.ts
 *
 * Assembles a `ProgramDependenceGraph` from already-built control
 * dependence (block granularity) and def-use chains (statement
 * granularity) — no new fixed-point computation, just lifting control
 * dependence to statements and combining it with data dependence.
 *
 * A block with >= 2 successors always ends with the statement that caused
 * the branch (CFG construction never appends anything to a block after its
 * conditional/switch/loop statement — see cfg/build.ts), so that block's
 * last statement is the controlling statement every other statement in a
 * control-dependent block is control-dependent on.
 */
import type { FunctionIr } from '../ir/contracts.js';
import type { FunctionCfg } from '../cfg/contracts.js';
import type { ControlDependence } from '../cfg/control-dependence.js';
import type { Definition, ReachingDefinitionsResult } from '../dataflow/reaching-definitions.js';
import type { DefUseChains } from '../dataflow/def-use.js';
import { PDG_VERSION, type PdgEdge, type ProgramDependenceGraph } from './contracts.js';

function controllingStatementOf(blockId: string, cfg: FunctionCfg): string | undefined {
  const statementIds = cfg.blocks[blockId]?.statementIds;
  return statementIds && statementIds.length > 0 ? statementIds[statementIds.length - 1] : undefined;
}

function buildControlEdges(cfg: FunctionCfg, controlDependence: ControlDependence): PdgEdge[] {
  const edges: PdgEdge[] = [];
  for (const [blockId, controllingBlockIds] of Object.entries(controlDependence.dependsOn)) {
    const block = cfg.blocks[blockId];
    if (!block) continue;
    for (const controllingBlockId of controllingBlockIds) {
      const controllingStatementId = controllingStatementOf(controllingBlockId, cfg);
      if (!controllingStatementId) continue;
      for (const statementId of block.statementIds) {
        edges.push({ kind: 'control', fromStatementId: controllingStatementId, toStatementId: statementId });
      }
    }
  }
  return edges;
}

function buildDataEdges(definitions: Readonly<Record<string, Definition>>, defUse: DefUseChains): PdgEdge[] {
  const edges: PdgEdge[] = [];
  for (const [defId, useStatementIds] of Object.entries(defUse.usesOfDefinition)) {
    const definition = definitions[defId];
    if (!definition) continue;
    for (const useStatementId of useStatementIds) {
      edges.push({ kind: 'data', fromStatementId: definition.statementId, toStatementId: useStatementId });
    }
  }
  return edges;
}

function edgeKey(edge: PdgEdge): string {
  return `${edge.kind}|${edge.fromStatementId}|${edge.toStatementId}`;
}

export function buildProgramDependenceGraph(input: {
  ir: FunctionIr;
  cfg: FunctionCfg;
  controlDependence: ControlDependence;
  reachingDefinitions: ReachingDefinitionsResult;
  defUse: DefUseChains;
}): ProgramDependenceGraph {
  const { ir, cfg, controlDependence, reachingDefinitions, defUse } = input;

  const seen = new Set<string>();
  const edges = [...buildControlEdges(cfg, controlDependence), ...buildDataEdges(reachingDefinitions.definitions, defUse)]
    .filter((edge) => {
      const key = edgeKey(edge);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)));

  return {
    version: PDG_VERSION,
    functionId: ir.functionId,
    statementIds: Object.keys(ir.statements).sort((a, b) => a.localeCompare(b)),
    edges,
    truncated: ir.truncated || cfg.truncated || reachingDefinitions.truncated,
    reason: ir.reason ?? cfg.reason ?? reachingDefinitions.reason,
  };
}
