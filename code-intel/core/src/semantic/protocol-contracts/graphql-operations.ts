import { createHash } from 'node:crypto';
import path from 'node:path';
import { Kind, print } from 'graphql';
import type { DocumentNode, FragmentDefinitionNode, OperationDefinitionNode, SelectionSetNode, ValueNode } from 'graphql';
import { convertTypeRef, GraphQLDepthLimitError, parseGraphQLDocument } from '../../multi-repo/schema-parsers/graphql-model.js';
import { attributeDocumentUse, attributeIdentifierUse, findGraphqlTemplates } from '../../multi-repo/protocol-facts.js';
import type { SymbolSpanIndex } from '../../multi-repo/symbol-spans.js';
import { GRAPHQL_LIMITS, type GraphQLOperationFact, type GraphQLOperationType, type GraphQLSelection } from './graphql-types.js';

interface ConversionState {
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  usedFragments: Set<string>;
  boundaries: Set<string>;
  selectionCount: number;
}

function enumLiterals(argument: string, value: ValueNode, out: Array<{ argument: string; value: string }>): void {
  if (value.kind === Kind.ENUM) out.push({ argument, value: value.value });
  else if (value.kind === Kind.LIST) for (const item of value.values) enumLiterals(argument, item, out);
}

function convertSelectionSet(set: SelectionSetNode | undefined, state: ConversionState, depth: number, typeCondition: string | undefined, visiting: ReadonlySet<string>): GraphQLSelection[] {
  if (!set) return [];
  if (depth > GRAPHQL_LIMITS.maxDepth) {
    state.boundaries.add('depth-limit');
    return [];
  }
  const out: GraphQLSelection[] = [];
  for (const selection of set.selections) {
    if (state.selectionCount >= GRAPHQL_LIMITS.maxSelectionsPerOperation) {
      state.boundaries.add('selection-limit');
      break;
    }
    if (selection.kind === Kind.FIELD) {
      state.selectionCount += 1;
      const argumentEnumLiterals: Array<{ argument: string; value: string }> = [];
      for (const argument of selection.arguments ?? []) enumLiterals(argument.name.value, argument.value, argumentEnumLiterals);
      out.push({
        field: selection.name.value,
        alias: selection.alias?.value,
        arguments: (selection.arguments ?? []).map((argument) => argument.name.value).sort(),
        argumentEnumLiterals,
        typeCondition,
        selections: convertSelectionSet(selection.selectionSet, state, depth + 1, undefined, visiting),
      });
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      out.push(...convertSelectionSet(selection.selectionSet, state, depth + 1, selection.typeCondition?.name.value ?? typeCondition, visiting));
    } else {
      const name = selection.name.value;
      const fragment = state.fragments.get(name);
      if (!fragment) {
        state.boundaries.add(`unresolved-fragment:${name}`);
        continue;
      }
      if (visiting.has(name)) {
        state.boundaries.add(`fragment-cycle:${name}`);
        continue;
      }
      state.usedFragments.add(name);
      out.push(...convertSelectionSet(fragment.selectionSet, state, depth + 1, fragment.typeCondition.name.value, new Set([...visiting, name])));
    }
  }
  return out;
}

function collectPaths(selections: readonly GraphQLSelection[], prefix: string, out: Set<string>): void {
  for (const selection of selections) {
    if (selection.field === '__typename') continue;
    const path = prefix ? `${prefix}.${selection.field}` : selection.field;
    out.add(path);
    collectPaths(selection.selections, path, out);
  }
}

function fingerprintOf(operation: OperationDefinitionNode, fragments: readonly FragmentDefinitionNode[]): string {
  const normalized = [print(operation), ...fragments.map((fragment) => print(fragment)).sort()].join('\n');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export interface OperationExtraction {
  operations: GraphQLOperationFact[];
  boundaries: string[];
}

/** Extracts every operation of an already-parsed document. `lineOffset` maps document lines to
 * file lines for documents embedded in JS/TS templates. */
export function operationsFromDocument(
  document: DocumentNode,
  context: { filePath: string; lineOffset: number; origin: GraphQLOperationFact['origin']; symbolId?: string; symbolName?: string; extraBoundaries?: readonly string[] },
): GraphQLOperationFact[] {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
  }
  const operations: GraphQLOperationFact[] = [];
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const state: ConversionState = { fragments, usedFragments: new Set(), boundaries: new Set(context.extraBoundaries ?? []), selectionCount: 0 };
    let variables: GraphQLOperationFact['variables'] = [];
    let selections: GraphQLSelection[] = [];
    try {
      variables = (definition.variableDefinitions ?? []).map((variable) => ({
        name: variable.variable.name.value,
        type: convertTypeRef(variable.type),
        defaultValue: variable.defaultValue ? print(variable.defaultValue) : undefined,
      }));
      selections = convertSelectionSet(definition.selectionSet, state, 0, undefined, new Set());
    } catch (error) {
      if (!(error instanceof GraphQLDepthLimitError)) throw error;
      state.boundaries.add('depth-limit');
    }
    const operationType = definition.operation as GraphQLOperationType;
    const fingerprint = fingerprintOf(definition, [...state.usedFragments].map((name) => fragments.get(name)!));
    const name = definition.name?.value;
    const paths = new Set<string>();
    collectPaths(selections, '', paths);
    const boundaryReasons = [...state.boundaries].sort();
    operations.push({
      operationId: `graphql-op:${operationType}:${name ?? 'anonymous'}:${fingerprint}`,
      operationType,
      name,
      fingerprint,
      variables,
      selections,
      selectedPaths: [...paths].sort(),
      filePath: context.filePath,
      line: context.lineOffset + (definition.loc?.startToken.line ?? 1) - 1,
      origin: context.origin,
      symbolId: context.symbolId,
      symbolName: context.symbolName,
      coverage: { complete: boundaryReasons.length === 0, boundaryReasons },
    });
  }
  return operations;
}

/** Operations in a standalone `.graphql`/`.gql` document. */
export function extractDocumentOperations(filePath: string, source: string): OperationExtraction {
  const parsed = parseGraphQLDocument(source);
  if (!parsed.ok) return { operations: [], boundaries: [`${parsed.reason}:${filePath}`] };
  return { operations: operationsFromDocument(parsed.document, { filePath, lineOffset: 1, origin: 'document' }), boundaries: [] };
}

const GRAPHQL_DOC_IMPORT = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.(?:graphql|gql))['"]/g;

export interface DocumentImportUse {
  /** Repository-relative path of the imported document. */
  documentPath: string;
  symbolId?: string;
  symbolName?: string;
  unresolvedReason?: string;
}

/**
 * Extracts operations from gql`...`/graphql`...` tagged templates in one JS/TS source file,
 * attributed to the function using them, plus `import Doc from './x.graphql'` uses (the
 * caller attributes the imported document's operations with them). `${...}` interpolations
 * (typically fragment documents) are not followed: they become a coverage boundary.
 */
export function extractSourceOperations(
  filePath: string,
  source: string,
  index: SymbolSpanIndex,
): OperationExtraction & { documentImports: DocumentImportUse[] } {
  const operations: GraphQLOperationFact[] = [];
  const boundaries: string[] = [];
  const lines = source.split('\n');
  for (const template of findGraphqlTemplates(source)) {
    const hasInterpolation = template.text.includes('${');
    const text = template.text.replace(/\$\{[^}]*\}/g, '');
    const parsed = parseGraphQLDocument(text);
    const line = source.slice(0, template.bodyStart).split('\n').length;
    if (!parsed.ok) {
      boundaries.push(`${parsed.reason}:${filePath}:${line}`);
      continue;
    }
    for (const use of attributeDocumentUse(index, filePath, source, lines, template.start)) {
      operations.push(...operationsFromDocument(parsed.document, {
        filePath,
        lineOffset: line,
        origin: 'tagged-template',
        symbolId: use.symbolId,
        symbolName: use.symbolName,
        extraBoundaries: [...(hasInterpolation ? ['template-interpolation'] : []), ...(use.unresolvedReason ? ['unattributed-document'] : [])],
      }));
    }
  }

  const documentImports: DocumentImportUse[] = [];
  for (const match of source.matchAll(GRAPHQL_DOC_IMPORT)) {
    if (!match[2]!.startsWith('.')) continue; // package imports are not repository documents
    const documentPath = path.posix.normalize(path.posix.join(path.posix.dirname(filePath.replace(/\\/g, '/')), match[2]!));
    const declarationLine = source.slice(0, match.index).split('\n').length;
    for (const use of attributeIdentifierUse(index, filePath, lines, match[1]!, declarationLine)) {
      documentImports.push({ documentPath, symbolId: use.symbolId, symbolName: use.symbolName, unresolvedReason: use.unresolvedReason });
    }
  }
  return { operations, boundaries, documentImports };
}

/** Re-attributes a standalone document's operations to the functions importing it (one
 * operation fact per using symbol, mirroring tagged-template attribution). */
export function attributeImportedOperations(operations: readonly GraphQLOperationFact[], imports: readonly DocumentImportUse[]): GraphQLOperationFact[] {
  const usesByDocument = new Map<string, DocumentImportUse[]>();
  for (const use of imports) usesByDocument.set(use.documentPath, [...(usesByDocument.get(use.documentPath) ?? []), use]);
  const out: GraphQLOperationFact[] = [];
  for (const operation of operations) {
    const uses = usesByDocument.get(operation.filePath.replace(/\\/g, '/')) ?? [];
    const resolvedUses = uses.filter((use) => use.symbolId);
    if (resolvedUses.length === 0) {
      out.push(operation);
      continue;
    }
    for (const use of resolvedUses) out.push({ ...operation, symbolId: use.symbolId, symbolName: use.symbolName });
  }
  return out;
}
