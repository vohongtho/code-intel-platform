import {
  GRAPHQL_LIMITS,
  graphqlFieldId,
  namedType,
  type GraphQLFieldDef,
  type GraphQLOperationFact,
  type GraphQLOperationMapping,
  type GraphQLSchemaModel,
  type GraphQLSelection,
  type GraphQLTypeDef,
} from './graphql-types.js';

interface SchemaIndex {
  types: ReadonlyMap<string, GraphQLTypeDef>;
  fields: ReadonlyMap<string, ReadonlyMap<string, GraphQLFieldDef>>;
}

/** Built once per schema object and reused across every operation mapped against it. */
const schemaIndexes = new WeakMap<GraphQLSchemaModel, SchemaIndex>();

function indexSchema(schema: GraphQLSchemaModel): SchemaIndex {
  let index = schemaIndexes.get(schema);
  if (!index) {
    index = {
      types: new Map(schema.types.map((type) => [type.name, type] as const)),
      fields: new Map(schema.types.map((type) => [type.name, new Map((type.fields ?? []).map((field) => [field.name, field] as const))] as const)),
    };
    schemaIndexes.set(schema, index);
  }
  return index;
}

interface MappingState {
  index: SchemaIndex;
  service: string;
  fieldIds: Set<string>;
  argumentRefs: Set<string>;
  enumRefs: Set<string>;
  unresolvedPaths: Set<string>;
}

function walk(selections: readonly GraphQLSelection[], parentType: string, prefix: string, state: MappingState, depth: number): void {
  if (depth > GRAPHQL_LIMITS.maxDepth) return;
  for (const selection of selections) {
    if (selection.field === '__typename') continue;
    const path = prefix ? `${prefix}.${selection.field}` : selection.field;
    const owner = selection.typeCondition ?? parentType;
    const field = state.index.fields.get(owner)?.get(selection.field);
    if (!field) {
      state.unresolvedPaths.add(path);
      continue;
    }
    state.fieldIds.add(graphqlFieldId(state.service, owner, field.name));
    for (const argument of selection.arguments) state.argumentRefs.add(`${owner}.${field.name}(${argument})`);
    for (const literal of selection.argumentEnumLiterals) {
      const argument = field.args.find((candidate) => candidate.name === literal.argument);
      if (argument) state.enumRefs.add(`${namedType(argument.type)}.${literal.value}`);
    }
    walk(selection.selections, namedType(field.type), path, state, depth + 1);
  }
}

/** Input object and enum types reachable from `typeName` through input fields. */
function collectInputTypes(typeName: string, types: ReadonlyMap<string, GraphQLTypeDef>, out: Set<string>): void {
  const type = types.get(typeName);
  if (!type || out.has(typeName) || (type.kind !== 'input' && type.kind !== 'enum' && type.kind !== 'scalar')) return;
  out.add(typeName);
  for (const field of type.inputFields ?? []) collectInputTypes(namedType(field.type), types, out);
}

/**
 * Maps one operation's selection tree onto one schema by type context: each selected field
 * is looked up on its parent type (or inline-fragment type condition), never by name
 * equality across the schema. Paths the schema does not define are returned as unresolved.
 */
export function mapOperationToSchema(operation: GraphQLOperationFact, schema: GraphQLSchemaModel): GraphQLOperationMapping {
  const index = indexSchema(schema);
  const types = index.types;
  const state: MappingState = {
    index,
    service: schema.service,
    fieldIds: new Set(),
    argumentRefs: new Set(),
    enumRefs: new Set(),
    unresolvedPaths: new Set(),
  };
  const rootType = schema.rootTypes[operation.operationType];
  if (rootType) walk(operation.selections, rootType, '', state, 0);
  else for (const selection of operation.selections) state.unresolvedPaths.add(selection.field);

  const inputTypes = new Set<string>();
  for (const variable of operation.variables) collectInputTypes(namedType(variable.type), types, inputTypes);

  const boundaryReasons = [...new Set([...operation.coverage.boundaryReasons, ...schema.coverage.boundaryReasons])].sort();
  const complete = boundaryReasons.length === 0;
  let certainty: GraphQLOperationMapping['certainty'] = 'unresolved';
  if (state.fieldIds.size > 0) certainty = state.unresolvedPaths.size === 0 && complete ? 'exact' : 'candidate';

  return {
    operationId: operation.operationId,
    service: schema.service,
    certainty,
    fieldIds: [...state.fieldIds].sort(),
    argumentRefs: [...state.argumentRefs].sort(),
    enumRefs: [...state.enumRefs].sort(),
    inputTypes: [...inputTypes].sort(),
    unresolvedPaths: [...state.unresolvedPaths].sort(),
    coverage: { complete, boundaryReasons },
  };
}

/**
 * Maps each operation against every candidate schema in scope. An operation is an `exact`
 * consumer of a schema only when that is the one schema its whole selection tree validates
 * against; several fully-validating schemas make every mapping a `candidate`; a schema it
 * only partially validates against is at most a `candidate`. Unresolved mappings (nothing
 * selected exists) are dropped.
 */
export function mapOperations(operations: readonly GraphQLOperationFact[], schemas: readonly GraphQLSchemaModel[]): GraphQLOperationMapping[] {
  const out: GraphQLOperationMapping[] = [];
  for (const operation of operations) {
    const mappings = schemas.map((schema) => mapOperationToSchema(operation, schema)).filter((mapping) => mapping.certainty !== 'unresolved');
    const fullyValid = mappings.filter((mapping) => mapping.unresolvedPaths.length === 0);
    const capped = mappings.length > GRAPHQL_LIMITS.maxCandidateSchemas;
    const kept = [...mappings]
      .sort((a, b) => b.fieldIds.length - a.fieldIds.length || a.service.localeCompare(b.service))
      .slice(0, GRAPHQL_LIMITS.maxCandidateSchemas);
    for (const mapping of kept) {
      const ambiguous = fullyValid.length > 1 && fullyValid.includes(mapping);
      const boundaryReasons = [
        ...mapping.coverage.boundaryReasons,
        ...(ambiguous ? ['ambiguous-schema-match'] : []),
        ...(capped ? ['candidate-cap-exceeded'] : []),
      ].sort();
      out.push({
        ...mapping,
        certainty: mapping.certainty === 'exact' && !ambiguous && !capped ? 'exact' : 'candidate',
        coverage: { complete: boundaryReasons.length === 0, boundaryReasons },
      });
    }
  }
  return out.sort((a, b) => a.operationId.localeCompare(b.operationId) || a.service.localeCompare(b.service));
}
