/**
 * pipeline.ts
 *
 * The single orchestration entry point existing workflows (inspect,
 * security, context — task 11) call into for on-demand, cached,
 * per-function static analysis. Every failure mode — no lowering table
 * for the language, a parse failure, no body node found at the given
 * range, an internal error — degrades to an explicit `capability` result
 * rather than throwing: this module is strictly additive/best-effort
 * evidence, never a dependency existing callers need to guard heavily
 * against. Callers own reading the source file and locating the target
 * symbol; this module owns everything from "parse this file" onward.
 */
import fs from 'node:fs';
import type { Node as TSNode } from 'web-tree-sitter';
import type { Language } from '../shared/languages.js';
import { parseSource } from '../parsing/parser-manager.js';
import { hashIdentityPayload } from '../identity/normalization.js';
import { PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from './contracts.js';
import { getLoweringTable } from './languages/lowering-tables.js';
import { lowerFunctionToIr } from './languages/generic-lowering.js';
import { validateFunctionIr } from './ir/validate.js';
import { buildFunctionCfg } from './cfg/build.js';
import { computeReachingDefinitions } from './dataflow/reaching-definitions.js';
import { computeDefUseChains } from './dataflow/def-use.js';
import { buildFunctionSummary } from './summaries/build.js';
import { FUNCTION_SUMMARY_VERSION, type FunctionSummary } from './summaries/contracts.js';
import type { FunctionIr } from './ir/contracts.js';
import { MemoryProgramAnalysisCache } from './cache/memory-cache.js';
import { getOrComputeArtifact } from './cache/get-or-compute.js';

const sharedCache = new MemoryProgramAnalysisCache();

export type FunctionAnalysisCapability = 'supported' | 'not-applicable' | 'unsupported';

export interface FunctionAnalysisRequest {
  language: Language;
  filePath: string;
  /** 1-based, inclusive — the function/method's own declared source range (e.g. `CodeNode.startLine`). */
  startLine: number;
  canonicalFunctionId: string;
  parameterNames?: readonly string[];
  resolverVersion: string;
  semanticGraphFingerprint?: string;
}

export interface FunctionAnalysisResult {
  capability: FunctionAnalysisCapability;
  reason?: string;
  summary?: FunctionSummary;
}

/**
 * Locates the function's body block from its declared start line: walks up
 * from the node at that position and, at each ancestor, searching a few
 * levels down for a block-type node — handles landing on the function
 * name, a keyword, or a decorator/modifier at that line (which may sit
 * two or more levels above the body, e.g. through an `export_statement`
 * wrapper), without needing per-language field access.
 */
function findBlockTypeWithin(node: TSNode, blockTypes: readonly string[], maxDepth: number): TSNode | null {
  if (blockTypes.includes(node.type)) return node;
  if (maxDepth <= 0) return null;
  for (const child of node.namedChildren) {
    if (!child) continue;
    const found = findBlockTypeWithin(child, blockTypes, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

function findBodyNode(root: TSNode, startLine: number, blockTypes: readonly string[]): TSNode | null {
  const row = Math.max(0, startLine - 1);
  let current: TSNode | null = root.descendantForPosition({ row, column: 0 });
  for (let hops = 0; current && hops < 8; hops += 1) {
    const found = findBlockTypeWithin(current, blockTypes, 4);
    if (found) return found;
    current = current.parent;
  }
  return null;
}

function degradedSummary(functionId: string, bodyHash: string, fingerprint: ProgramAnalysisFingerprint, reason: string): FunctionSummary {
  return {
    version: FUNCTION_SUMMARY_VERSION,
    functionId,
    bodyHash,
    fingerprint,
    parameterInfluence: [],
    localAccesses: [],
    boundaryWriteStatementIds: [],
    calledCallees: [],
    unresolvedUseStatementIds: [],
    truncated: true,
    reason,
  };
}

function computeSummary(ir: FunctionIr, bodyHash: string, fingerprint: ProgramAnalysisFingerprint, parameterNames: readonly string[]): FunctionSummary {
  const irValidation = validateFunctionIr(ir);
  if (!irValidation.valid) {
    return degradedSummary(ir.functionId, bodyHash, fingerprint, `lowered IR failed validation: ${irValidation.errors.slice(0, 3).join('; ')}`);
  }
  const cfg = buildFunctionCfg(ir);
  const reachingDefinitions = computeReachingDefinitions(ir, cfg);
  const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
  return buildFunctionSummary({ ir, parameterNames, reachingDefinitions, defUse, bodyHash, fingerprint });
}

/**
 * Analyzes one function on demand. Never throws — any failure (unsupported
 * language, unreadable file, parse failure, no body node found) comes back
 * as `{ capability: 'unsupported'|'not-applicable', reason }` instead.
 */
export async function analyzeFunction(request: FunctionAnalysisRequest): Promise<FunctionAnalysisResult> {
  try {
    const table = getLoweringTable(request.language);
    if (!table) {
      return { capability: 'unsupported', reason: `no program-analysis lowering table for language ${request.language}` };
    }

    let sourceText: string;
    try {
      sourceText = fs.readFileSync(request.filePath, 'utf8');
    } catch (err) {
      return { capability: 'unsupported', reason: `could not read source file: ${err instanceof Error ? err.message : String(err)}` };
    }

    const tree = await parseSource(request.language, sourceText).catch(() => null);
    if (!tree) return { capability: 'unsupported', reason: 'tree-sitter parse failed or grammar unavailable' };

    const bodyNode = findBodyNode(tree.rootNode as unknown as TSNode, request.startLine, table.blockTypes);
    if (!bodyNode) return { capability: 'unsupported', reason: 'could not locate a function body node at the given source range' };

    const bodyHash = hashIdentityPayload(bodyNode.text);
    const fingerprint: ProgramAnalysisFingerprint = {
      programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
      languageLoweringVersion: table.loweringVersion,
      resolverVersion: request.resolverVersion,
      semanticGraphFingerprint: request.semanticGraphFingerprint,
    };
    const parameterNames = request.parameterNames ?? [];

    const summary = getOrComputeArtifact(
      sharedCache,
      { kind: 'function-summary', canonicalFunctionId: request.canonicalFunctionId, bodyHash, fingerprint },
      () => {
        const ir = lowerFunctionToIr({
          bodyNode,
          language: request.language,
          functionId: request.canonicalFunctionId,
          filePath: request.filePath,
          parameterNames,
        });
        return computeSummary(ir, bodyHash, fingerprint, parameterNames);
      },
    );

    return { capability: 'supported', summary };
  } catch (err) {
    return { capability: 'unsupported', reason: `internal error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
