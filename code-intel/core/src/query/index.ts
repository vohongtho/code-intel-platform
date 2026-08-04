/**
 * Query module — re-exports for GQL parser, executor, saved queries, and change analysis.
 */

export {
  parseGQL,
  isGQLParseError,
  type QueryAST,
  type FindStatement,
  type TraverseStatement,
  type PathStatement,
  type CountStatement,
  type WhereClause,
  type WhereExpr,
  type WhereOperator,
  type GQLParseError,
  type Token,
  type TokenKind,
  type NodeKindFilter,
} from './gql-parser.js';

export { executeGQL } from './gql-executor.js';
export type { GQLResult, CountGroup, GQLResultKind } from 'code-intel-shared';

export {
  saveQuery,
  loadQuery,
  listQueries,
  deleteQuery,
  queryExists,
  type SavedQueryInfo,
} from './saved-queries.js';

export {
  buildChangeContext,
  type ChangeContextOptions,
  type ChangeContextResult,
  type ChangeContextTestSuggestion,
} from './change-context.js';
