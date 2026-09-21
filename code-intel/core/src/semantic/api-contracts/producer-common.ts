import type { Language } from '../../shared/languages.js';
import type { SourceRange } from '../anchors.js';
import type { FrameworkEvidenceFact } from '../facts.js';
import {
  type ApiBoundaryReason,
  type HttpRequestShapeFact,
  type HttpResponseShapeFact,
  type HttpRouteFact,
  type HttpRouteResponseVariant,
  type HttpShapeFieldFact,
  fullApiCoverage,
  partialApiCoverage,
} from './types.js';
import { computeShapeFingerprint } from './shape-normalizer.js';
import { normalizeHttpMethod, normalizeRoutePath } from './route-normalizer.js';

export interface FunctionBodyRange {
  /** 1-based line of the declaration. */
  declLine: number;
  /** 1-based line of the matching closing brace. */
  end: number;
}

/** Splits `text` on `sep` at bracket/brace/paren depth 0 only. */
export function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Finds `name`'s function/arrow-function body by brace counting from its declaration line,
 * within a single file. Does not resolve handlers imported from, or defined in, another
 * file — callers must treat a `undefined` result as an unresolved-shape boundary, not fall
 * back to guessing.
 */
export function findFunctionBodyRange(lines: readonly string[], name: string): FunctionBodyRange | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\(|^(?:export\\s+)?(?:const|let)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\(`,
  );
  for (let i = 0; i < lines.length; i += 1) {
    if (!declPattern.test(lines[i]!.trim())) continue;
    let depth = 0;
    let started = false;
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]!) {
        if (ch === '{') {
          depth += 1;
          started = true;
        } else if (ch === '}') {
          depth -= 1;
        }
      }
      if (started && depth <= 0) return { declLine: i + 1, end: j + 1 };
    }
    return undefined;
  }
  return undefined;
}

export interface ParsedObjectLiteral {
  fields: HttpShapeFieldFact[];
  hasSpread: boolean;
}

/** Parses a single-line `{ a, b: expr, ... }` literal into field names. Returns undefined
 * when `text` is not (syntactically, shallowly) an object literal — callers must treat that
 * as "shape not statically provable", never as "shape is empty". */
export function parseInlineObjectKeys(text: string): ParsedObjectLiteral | undefined {
  const trimmed = text.trim().replace(/;$/, '');
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return { fields: [], hasSpread: false };

  const fields: HttpShapeFieldFact[] = [];
  let hasSpread = false;
  for (const rawPart of splitTopLevel(inner, ',')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.startsWith('...')) {
      hasSpread = true;
      continue;
    }
    const colonIndex = findTopLevelColon(part);
    const rawKey = (colonIndex === -1 ? part : part.slice(0, colonIndex)).trim();
    const key = rawKey.replace(/^["']|["']$/g, '');
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) return undefined; // computed/dynamic key: can't prove statically
    fields.push({ key, required: true });
  }
  return { fields, hasSpread };
}

function findTopLevelColon(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

export interface ExtractedResponse {
  status: number;
  /** undefined when the response argument was not a statically parseable object literal. */
  parsed: ParsedObjectLiteral | undefined;
}

const RESPONSE_WITH_STATUS = /\b(?:res|reply)\.(?:status|code)\((\d+)\)\.(?:json|send)\((.+)\)\s*;?\s*$/;
const RESPONSE_NO_STATUS = /\b(?:res|reply)\.(?:json|send)\((.+)\)\s*;?\s*$/;

/** Scans [start,end] (1-based, inclusive) for single-line res/reply.json|send(...) calls. */
export function extractResponsesFromRange(lines: readonly string[], start: number, end: number): ExtractedResponse[] {
  const responses: ExtractedResponse[] = [];
  for (let i = start - 1; i < end && i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const withStatus = line.match(RESPONSE_WITH_STATUS);
    if (withStatus) {
      responses.push({ status: Number(withStatus[1]), parsed: parseInlineObjectKeys(withStatus[2]!) });
      continue;
    }
    const noStatus = line.match(RESPONSE_NO_STATUS);
    if (noStatus) {
      responses.push({ status: 200, parsed: parseInlineObjectKeys(noStatus[1]!) });
    }
  }
  return responses;
}

const BODY_MEMBER_PATTERN = /\b(?:req|request)\.body\.([A-Za-z_$][\w$]*)/g;
const BODY_DESTRUCTURE_PATTERN = /const\s*\{([^}]+)\}\s*=\s*(?:req|request)\.body/;

export interface ExtractedRequestShape {
  fields: HttpShapeFieldFact[];
  /** True when at least one req.body access/destructure was found in range. */
  matched: boolean;
}

/** Scans [start,end] (1-based, inclusive) for req/request.body member access and destructuring. */
export function extractRequestKeysFromRange(lines: readonly string[], start: number, end: number): ExtractedRequestShape {
  const keys = new Set<string>();
  let matched = false;
  for (let i = start - 1; i < end && i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const destructure = line.match(BODY_DESTRUCTURE_PATTERN);
    if (destructure) {
      matched = true;
      for (const part of destructure[1]!.split(',')) {
        const name = part.split(':')[0]!.trim().split('=')[0]!.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) keys.add(name);
      }
    }
    for (const match of line.matchAll(BODY_MEMBER_PATTERN)) {
      matched = true;
      keys.add(match[1]!);
    }
  }
  // Usage (not declaration) proves a field is read, never that it is required.
  return { fields: [...keys].sort().map((key) => ({ key, required: undefined })), matched };
}

export interface HttpProducerFactInputs {
  factId: string;
  language: Language;
  filePath: string;
  sourceRange: SourceRange;
  method: string | undefined;
  path: string;
  handlerRef?: string;
  middlewareRefs: readonly string[];
  authEvidence?: readonly string[];
  framework: string;
  frameworkEvidence: FrameworkEvidenceFact;
  requestShape?: ExtractedRequestShape;
  responses?: readonly ExtractedResponse[];
  extraBoundaries?: readonly ApiBoundaryReason[];
}

export interface HttpProducerFacts {
  routeFact: HttpRouteFact;
  requestShapeFact?: HttpRequestShapeFact;
  responseShapeFacts: HttpResponseShapeFact[];
}

/** Assembles HttpRouteFact + co-located shape facts from extracted evidence. Never fabricates
 * a shape: any unresolved response/request evidence widens `coverage.boundaryReasons` instead. */
export function buildHttpProducerFacts(input: HttpProducerFactInputs): HttpProducerFacts {
  const normalized = normalizeRoutePath(input.path);
  const boundaries: ApiBoundaryReason[] = [...(input.extraBoundaries ?? [])];
  if (normalized.hasDynamicPrefix) boundaries.push('dynamic-path-segment');

  let requestShapeFact: HttpRequestShapeFact | undefined;
  let requestShapeRef: string | undefined;
  if (input.requestShape && input.requestShape.matched) {
    const origin = { kind: 'inline' as const, fields: input.requestShape.fields };
    const shapeFingerprint = computeShapeFingerprint(origin);
    requestShapeFact = {
      factId: `${input.factId}:request-shape`,
      language: input.language,
      filePath: input.filePath,
      sourceRange: input.sourceRange,
      shapeFactKind: 'http-request-shape',
      shapeFingerprint,
      origin,
      coverage: fullApiCoverage(),
    };
    requestShapeRef = shapeFingerprint;
  }

  const responseShapeFacts: HttpResponseShapeFact[] = [];
  const responseVariants: HttpRouteResponseVariant[] = [];
  (input.responses ?? []).forEach((response, index) => {
    if (!response.parsed) {
      responseVariants.push({ status: response.status, evidence: 'unknown' });
      boundaries.push('unresolved-response-shape');
      return;
    }
    const origin = { kind: 'inline' as const, fields: response.parsed.fields };
    const shapeFingerprint = computeShapeFingerprint(origin);
    const complete = !response.parsed.hasSpread;
    if (!complete) boundaries.push('unresolved-response-shape');
    responseShapeFacts.push({
      factId: `${input.factId}:response-shape:${index}`,
      language: input.language,
      filePath: input.filePath,
      sourceRange: input.sourceRange,
      shapeFactKind: 'http-response-shape',
      status: response.status,
      shapeFingerprint,
      origin,
      coverage: complete ? fullApiCoverage() : partialApiCoverage(['unresolved-response-shape']),
    });
    responseVariants.push({
      status: response.status,
      responseShapeRef: shapeFingerprint,
      evidence: complete ? 'exact' : 'heuristic',
    });
  });

  const coverage = boundaries.length === 0 ? fullApiCoverage() : partialApiCoverage(boundaries);

  const routeFact: HttpRouteFact = {
    factId: input.factId,
    language: input.language,
    filePath: input.filePath,
    sourceRange: input.sourceRange,
    frameworkEvidence: input.frameworkEvidence,
    routeFactKind: 'http-route',
    method: normalizeHttpMethod(input.method),
    path: input.path,
    normalizedPath: normalized.normalizedPath,
    handlerRef: input.handlerRef,
    middlewareRefs: input.middlewareRefs,
    authEvidence: input.authEvidence,
    requestShapeRef,
    responses: responseVariants,
    framework: input.framework,
    coverage,
  };

  return { routeFact, requestShapeFact, responseShapeFacts };
}
