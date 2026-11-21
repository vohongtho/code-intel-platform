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
import { generateProgramAnalysisArtifactId, PROGRAM_ANALYSIS_VERSION, type ProgramAnalysisFingerprint } from './contracts.js';
import { getLoweringTable } from './languages/lowering-tables.js';
import { lowerFunctionToIr } from './languages/generic-lowering.js';
import { validateFunctionIr } from './ir/validate.js';
import { buildFunctionCfg } from './cfg/build.js';
import { computeControlDependence } from './cfg/control-dependence.js';
import { computeReachingDefinitions } from './dataflow/reaching-definitions.js';
import { computeDefUseChains } from './dataflow/def-use.js';
import { buildProgramDependenceGraph } from './pdg/build.js';
import type { ProgramDependenceGraph } from './pdg/contracts.js';
import { buildFunctionSummary } from './summaries/build.js';
import { FUNCTION_SUMMARY_VERSION, type FunctionSummary } from './summaries/contracts.js';
import type { FunctionIr } from './ir/contracts.js';
import type { ProgramAnalysisLimits } from './limits.js';
import { MemoryProgramAnalysisCache } from './cache/memory-cache.js';
import { getOrComputeArtifact } from './cache/get-or-compute.js';
import { computeTaintFindings } from './taint/build.js';
import type { TaintAnalysisResult, TaintCallResolver, TaintFunctionSummary } from './taint/contracts.js';
import type { TaintModelRegistry } from './taint/model-registry.js';
import type { TaintFunctionContext } from './taint/matching.js';
import { buildTaintFunctionSummary } from './taint/summary.js';

const sharedCache = new MemoryProgramAnalysisCache();

/** Test hook: the process-wide program-analysis cache (stats/clear). */
export function getSharedProgramAnalysisCache(): MemoryProgramAnalysisCache {
  return sharedCache;
}

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

export interface FunctionDependenceAnalysisResult {
  capability: FunctionAnalysisCapability;
  reason?: string;
  ir?: FunctionIr;
  pdg?: ProgramDependenceGraph;
  cacheHit: boolean;
}

interface PreparedFunctionAnalysis {
  bodyNode: TSNode;
  bodyHash: string;
  fingerprint: ProgramAnalysisFingerprint;
  parameterNames: readonly string[];
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

async function prepareFunctionAnalysis(request: FunctionAnalysisRequest): Promise<PreparedFunctionAnalysis | FunctionAnalysisResult> {
  const table = getLoweringTable(request.language);
  if (!table) return { capability: 'unsupported', reason: `no program-analysis lowering table for language ${request.language}` };

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

  return {
    bodyNode,
    bodyHash: hashIdentityPayload(bodyNode.text),
    fingerprint: {
      programAnalysisVersion: PROGRAM_ANALYSIS_VERSION,
      languageLoweringVersion: table.loweringVersion,
      resolverVersion: request.resolverVersion,
      semanticGraphFingerprint: request.semanticGraphFingerprint,
    },
    parameterNames: request.parameterNames ?? [],
  };
}

/**
 * Analyzes one function on demand. Never throws — any failure (unsupported
 * language, unreadable file, parse failure, no body node found) comes back
 * as `{ capability: 'unsupported'|'not-applicable', reason }` instead.
 */
export async function analyzeFunction(request: FunctionAnalysisRequest): Promise<FunctionAnalysisResult> {
  try {
    const prepared = await prepareFunctionAnalysis(request);
    if ('capability' in prepared) return prepared;
    const { bodyNode, bodyHash, fingerprint, parameterNames } = prepared;

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

/** Builds and caches the PDG while returning the same lowered IR whose existing SourceRanges seed change slicing. */
export async function analyzeFunctionDependence(request: FunctionAnalysisRequest): Promise<FunctionDependenceAnalysisResult> {
  try {
    const prepared = await prepareFunctionAnalysis(request);
    if ('capability' in prepared) return { ...prepared, cacheHit: false };
    const ir = lowerFunctionToIr({
      bodyNode: prepared.bodyNode,
      language: request.language,
      functionId: request.canonicalFunctionId,
      filePath: request.filePath,
      parameterNames: prepared.parameterNames,
    });
    const validation = validateFunctionIr(ir);
    if (!validation.valid) {
      return { capability: 'unsupported', reason: `lowered IR failed validation: ${validation.errors.slice(0, 3).join('; ')}`, cacheHit: false };
    }

    const key = {
      kind: 'pdg' as const,
      canonicalFunctionId: request.canonicalFunctionId,
      bodyHash: prepared.bodyHash,
      fingerprint: prepared.fingerprint,
    };
    const artifactId = generateProgramAnalysisArtifactId(key);
    const cacheHit = sharedCache.has(artifactId);
    const pdg = getOrComputeArtifact(sharedCache, key, () => {
      const cfg = buildFunctionCfg(ir);
      const reachingDefinitions = computeReachingDefinitions(ir, cfg);
      const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
      return buildProgramDependenceGraph({
        ir,
        cfg,
        controlDependence: computeControlDependence(cfg),
        reachingDefinitions,
        defUse,
      });
    });
    return { capability: 'supported', ir, pdg, cacheHit };
  } catch (err) {
    return { capability: 'unsupported', reason: `internal error: ${err instanceof Error ? err.message : String(err)}`, cacheHit: false };
  }
}

export interface FunctionTaintRequest extends FunctionAnalysisRequest {
  registry: TaintModelRegistry;
  context?: TaintFunctionContext;
  /** Interprocedural mode. Results then depend on callee summaries and are not cached as a whole (summaries are). */
  callResolver?: TaintCallResolver;
  limits?: ProgramAnalysisLimits;
}

export interface FunctionTaintAnalysisResult {
  capability: FunctionAnalysisCapability;
  reason?: string;
  result?: TaintAnalysisResult;
  cacheHit: boolean;
}

interface LoweredFunction {
  ir: FunctionIr;
  bodyHash: string;
  fingerprint: ProgramAnalysisFingerprint;
  parameterNames: readonly string[];
}

async function lowerForTaint(request: FunctionTaintRequest): Promise<LoweredFunction | FunctionTaintAnalysisResult> {
  const prepared = await prepareFunctionAnalysis(request);
  if ('capability' in prepared) return { ...prepared, cacheHit: false };
  const ir = lowerFunctionToIr({
    bodyNode: prepared.bodyNode,
    language: request.language,
    functionId: request.canonicalFunctionId,
    filePath: request.filePath,
    parameterNames: prepared.parameterNames,
    limits: request.limits,
  });
  const validation = validateFunctionIr(ir);
  if (!validation.valid) {
    return { capability: 'unsupported', reason: `lowered IR failed validation: ${validation.errors.slice(0, 3).join('; ')}`, cacheHit: false };
  }
  // The model fingerprint and the caller-supplied context both shape findings, so both are part of the cache identity.
  const fingerprint: ProgramAnalysisFingerprint = {
    ...prepared.fingerprint,
    taintModelFingerprint: hashIdentityPayload({ model: request.registry.fingerprint, context: request.context ?? null, limits: request.limits ?? null }),
  };
  return { ir, bodyHash: prepared.bodyHash, fingerprint, parameterNames: prepared.parameterNames };
}

function dataflowFor(ir: FunctionIr, limits?: ProgramAnalysisLimits) {
  const cfg = buildFunctionCfg(ir, limits);
  const reachingDefinitions = computeReachingDefinitions(ir, cfg, limits);
  const defUse = computeDefUseChains(ir, cfg, reachingDefinitions);
  return { cfg, reachingDefinitions, defUse };
}

/**
 * Taint findings for one function under a model registry. Intraprocedural
 * results are cached under a key that includes the registry fingerprint,
 * so a changed model (same source) misses the cache and recomputes.
 */
export async function analyzeFunctionTaint(request: FunctionTaintRequest): Promise<FunctionTaintAnalysisResult> {
  try {
    const lowered = await lowerForTaint(request);
    if ('capability' in lowered) return lowered;
    const compute = () => computeTaintFindings({ ir: lowered.ir, ...dataflowFor(lowered.ir, request.limits), registry: request.registry, context: request.context, callResolver: request.callResolver, limits: request.limits });
    if (request.callResolver) return { capability: 'supported', result: compute(), cacheHit: false };
    const key = { kind: 'taint-findings' as const, canonicalFunctionId: request.canonicalFunctionId, bodyHash: lowered.bodyHash, fingerprint: lowered.fingerprint };
    const cacheHit = sharedCache.has(generateProgramAnalysisArtifactId(key));
    return { capability: 'supported', result: getOrComputeArtifact(sharedCache, key, compute), cacheHit };
  } catch (err) {
    return { capability: 'unsupported', reason: `internal error: ${err instanceof Error ? err.message : String(err)}`, cacheHit: false };
  }
}

export interface FunctionTaintSummaryResult {
  capability: FunctionAnalysisCapability;
  reason?: string;
  summary?: TaintFunctionSummary;
  cacheHit: boolean;
}

/** Parameter-to-sink/return taint summary. Cached (content + model + context keyed) only when computed without a call resolver. */
export async function analyzeFunctionTaintSummary(request: FunctionTaintRequest): Promise<FunctionTaintSummaryResult> {
  try {
    const lowered = await lowerForTaint(request);
    if ('capability' in lowered) return lowered;
    const compute = () => buildTaintFunctionSummary({
      ir: lowered.ir,
      ...dataflowFor(lowered.ir, request.limits),
      registry: request.registry,
      context: request.context,
      parameterNames: lowered.parameterNames,
      callResolver: request.callResolver,
      limits: request.limits,
    });
    if (request.callResolver) return { capability: 'supported', summary: compute(), cacheHit: false };
    const key = { kind: 'taint-summary' as const, canonicalFunctionId: request.canonicalFunctionId, bodyHash: lowered.bodyHash, fingerprint: lowered.fingerprint };
    const cacheHit = sharedCache.has(generateProgramAnalysisArtifactId(key));
    return { capability: 'supported', summary: getOrComputeArtifact(sharedCache, key, compute), cacheHit };
  } catch (err) {
    return { capability: 'unsupported', reason: `internal error: ${err instanceof Error ? err.message : String(err)}`, cacheHit: false };
  }
}
