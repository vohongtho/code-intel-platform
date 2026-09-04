/**
 * ir/contracts.ts
 *
 * Universal per-function intermediate representation. Language lowering
 * adapters (task 3) each produce a `FunctionIr`; every later stage (CFG,
 * dominators, data flow, PDG, taint) consumes this shape rather than any
 * language-specific AST, so a single set of algorithms covers every
 * supported language.
 */
import type { Language } from '../../shared/languages.js';
import type { SourceRange } from '../../semantic/anchors.js';
import { generateIrNodeId } from '../contracts.js';

export type IrStatementKind =
  | 'declaration'
  | 'assignment'
  | 'call'
  | 'return'
  | 'throw'
  | 'conditional'
  | 'switch'
  | 'loop'
  | 'break'
  | 'continue'
  | 'try'
  | 'await'
  | 'yield'
  | 'label'
  | 'goto'
  | 'unknown';

export type IrExpressionKind =
  | 'literal'
  | 'local-read'
  | 'parameter-read'
  | 'member-read'
  | 'index-read'
  | 'unary'
  | 'binary'
  | 'call'
  | 'new'
  | 'lambda'
  | 'cast'
  | 'type-test'
  | 'unknown';

export interface IrNodeBase {
  id: string;
  functionId: string;
  range: SourceRange;
  /** Set whenever lowering could not model this construct exactly; paired with `uncertaintyReason`. */
  uncertain?: boolean;
  uncertaintyReason?: string;
}

/** `name` carries a best-effort local/parameter/member name for reads and declarations; absent when lowering can't recover one. */
export interface IrExpression extends IrNodeBase {
  kind: IrExpressionKind;
  operands: readonly string[];
  name?: string;
}

/** if/else — `else` is absent for a bare `if` with no else branch. */
export interface ConditionalBranches {
  kind: 'conditional';
  then: readonly string[];
  else?: readonly string[];
}

export interface SwitchCaseGroup {
  body: readonly string[];
  isDefault: boolean;
}

export interface SwitchBranches {
  kind: 'switch';
  cases: readonly SwitchCaseGroup[];
}

export interface TryCatchGroup {
  body: readonly string[];
}

export interface TryBranches {
  kind: 'try';
  body: readonly string[];
  catches: readonly TryCatchGroup[];
  finallyBody?: readonly string[];
}

export interface LoopBranches {
  kind: 'loop';
  body: readonly string[];
}

export interface LabelBranches {
  kind: 'label';
  body: readonly string[];
}

/**
 * Branch topology for a container statement kind (conditional/switch/loop/
 * try/label). CFG construction (and everything built on it) reads this
 * instead of the flattened `children` list, because `children` alone can't
 * tell a then-branch statement from an else-branch statement.
 */
export type StatementBranches = ConditionalBranches | SwitchBranches | TryBranches | LoopBranches | LabelBranches;

export interface IrStatement extends IrNodeBase {
  kind: IrStatementKind;
  /** Expressions this statement directly evaluates (condition, call, returned/thrown value, assigned RHS, ...). */
  expressions: readonly string[];
  /** Write-target expressions for declaration/assignment statements (local-read/member-read/index-read acting as an lvalue). */
  targets: readonly string[];
  /**
   * Every nested statement id, flattened across all branches, in source
   * order — required exactly for container kinds (conditional/switch/loop/
   * try/label) and must equal the union of `branches`' own id lists; absent
   * for leaf statement kinds. Convenient for consumers that only need "every
   * nested id" (e.g. structural validation); topology-aware consumers
   * (CFG, dominators, ...) must read `branches` instead.
   */
  children: readonly string[];
  /** Branch topology; present if and only if `kind` is a container kind. */
  branches?: StatementBranches;
  /** Matches a `goto` statement's target to the `label` statement it jumps to. */
  labelName?: string;
}

export interface FunctionIr {
  version: string;
  functionId: string;
  language: Language;
  /** Root statement of the function body, in lowering order; `null` for a body lowering produced no statements. */
  entryStatementId: string | null;
  statements: Readonly<Record<string, IrStatement>>;
  expressions: Readonly<Record<string, IrExpression>>;
  /** Every statement id, in deterministic source/lowering order. */
  order: readonly string[];
  truncated: boolean;
  reason?: string;
}

export const IR_VERSION = 'ir-v1';

const CONTAINER_STATEMENT_KINDS: ReadonlySet<IrStatementKind> = new Set(['conditional', 'switch', 'loop', 'try', 'label']);

export function isContainerStatementKind(kind: IrStatementKind): boolean {
  return CONTAINER_STATEMENT_KINDS.has(kind);
}

/**
 * Statement ids that are not any other statement's child — i.e. the
 * function body's direct top-level sequence, in source order. `order` is
 * pre-order (a statement is recorded before its nested children), so
 * filtering out every id that appears in some `children` list, while
 * preserving `order`'s relative sequence, reconstructs that top-level list
 * without needing a dedicated field.
 */
export function getTopLevelStatementIds(ir: FunctionIr): string[] {
  const owned = new Set<string>();
  for (const statement of Object.values(ir.statements)) {
    for (const childId of statement.children) owned.add(childId);
  }
  return ir.order.filter((id) => !owned.has(id));
}

/** Every nested statement id referenced by `branches`, in a fixed (branch-major) order. */
export function flattenStatementBranches(branches: StatementBranches): string[] {
  switch (branches.kind) {
    case 'conditional':
      return [...branches.then, ...(branches.else ?? [])];
    case 'switch':
      return branches.cases.flatMap((group) => group.body);
    case 'try':
      return [...branches.body, ...branches.catches.flatMap((group) => group.body), ...(branches.finallyBody ?? [])];
    case 'loop':
    case 'label':
      return [...branches.body];
    default: {
      const exhaustive: never = branches;
      throw new Error(`unhandled branch kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function generateStatementId(functionArtifactId: string, localIndex: number): string {
  return generateIrNodeId(`${functionArtifactId}:stmt`, localIndex);
}

export function generateExpressionId(functionArtifactId: string, localIndex: number): string {
  return generateIrNodeId(`${functionArtifactId}:expr`, localIndex);
}
