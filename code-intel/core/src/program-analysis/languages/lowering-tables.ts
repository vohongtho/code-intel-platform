/**
 * languages/lowering-tables.ts
 *
 * Per-language configuration for the generic tree-sitter-to-universal-IR
 * lowering engine (generic-lowering.ts). Node type names below were
 * confirmed by parsing representative snippets with this repo's bundled
 * tree-sitter grammars (dist/wasm/*.wasm), not guessed from documentation —
 * see the change's task-3 notes. Coverage is intentionally shallow: only
 * the constructs listed here are recognized exactly. Everything else lowers
 * to an explicit `unknown`/uncertain node per the spec's truthful-reporting
 * requirement rather than being silently treated as a no-op.
 *
 * Dart's bundled grammar fails to load under the web-tree-sitter version
 * pinned in this repo (a pre-existing runtime issue, unrelated to this
 * change), so its table below could not be verified against a real parse.
 * Its capability row is marked 'partial' rather than 'supported' to reflect
 * that lower confidence honestly.
 */
import { Language } from '../../shared/languages.js';
import type { IrExpressionKind, IrStatementKind } from '../ir/contracts.js';

/**
 * Node type categories used to build branch-discriminated `then`/`else`,
 * switch case groups, and try/catch/finally partitions (see
 * ir/contracts.ts `StatementBranches`) — a flat "clause" list can't tell
 * these apart, which is exactly the ambiguity CFG construction needs
 * resolved.
 */
export interface ClauseTypeCategories {
  /** else/elif/elsif wrapper for a conditional's alternate branch (omit if the language attaches it directly, e.g. Java). */
  elseTypes: readonly string[];
  /** catch/except/rescue clause wrapper for a try statement. */
  catchTypes: readonly string[];
  /** finally/ensure clause wrapper for a try statement. */
  finallyTypes: readonly string[];
  /** Node type that holds all of a switch's cases together (e.g. `switch_body`); omit if cases are direct children of the switch node. */
  caseContainerTypes: readonly string[];
  /** One case/when/entry group within a switch. */
  caseTypes: readonly string[];
  /** Subset of node types from `caseTypes` (or a distinct default-only type) marking the default/else case. */
  defaultCaseTypes: readonly string[];
}

export interface LanguageLoweringTable {
  language: Language;
  loweringVersion: string;
  /** Node types holding a sequence of sibling statements (function/if/loop/case bodies). */
  blockTypes: readonly string[];
  /** Node types unwrapped to their sole namedChild before classification (generic statement/parenthesis wrappers). */
  transparentWrapperTypes: readonly string[];
  /** Node type -> statement kind, matched directly once unwrapped. */
  statementKindByType: Readonly<Partial<Record<string, IrStatementKind>>>;
  /** The language's generic "expression used as a statement" wrapper node type, if any (e.g. `expression_statement`). */
  expressionStatementWrapperType?: string;
  /** Node type found inside `expressionStatementWrapperType` -> resulting statement kind. */
  expressionStatementInnerKind: Readonly<Partial<Record<string, IrStatementKind>>>;
  /** Categorized clause/case wrapper node types used to build branch topology for conditional/switch/try. */
  clauses: ClauseTypeCategories;
  /** Node type -> expression kind, for shallow single-level expression recognition (no nested operand lowering). */
  expressionKindByType: Readonly<Partial<Record<string, IrExpressionKind>>>;
  /** Node types whose text should be read as the target of a `label`/`goto` statement. */
  labelIdentifierTypes: readonly string[];
  /** Node types where the real statement kind is collapsed into one grammar node and must be read from the leading source token (e.g. Swift's `control_transfer_statement`). */
  collapsedControlTransferTypes?: readonly string[];
  /** Leading source token (first word) -> statement kind, used together with `collapsedControlTransferTypes`. */
  disambiguateByLeadingText?: Readonly<Partial<Record<string, IrStatementKind>>>;
}

const CONTROL_TRANSFER_BY_LEADING_WORD: Readonly<Partial<Record<string, IrStatementKind>>> = {
  return: 'return',
  break: 'break',
  continue: 'continue',
  throw: 'throw',
};

function jsFamilyTable(language: Language, adapterId: string): LanguageLoweringTable {
  return {
    language,
    loweringVersion: `${adapterId}-lowering-v1`,
    blockTypes: ['statement_block'],
    transparentWrapperTypes: ['parenthesized_expression'],
    statementKindByType: {
      lexical_declaration: 'declaration',
      variable_declaration: 'declaration',
      if_statement: 'conditional',
      for_statement: 'loop',
      for_in_statement: 'loop',
      while_statement: 'loop',
      do_statement: 'loop',
      switch_statement: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      throw_statement: 'throw',
      try_statement: 'try',
      labeled_statement: 'label',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      call_expression: 'call',
      assignment_expression: 'assignment',
      update_expression: 'assignment',
      await_expression: 'await',
      yield_expression: 'yield',
    },
    clauses: {
      elseTypes: ['else_clause'],
      catchTypes: ['catch_clause'],
      finallyTypes: ['finally_clause'],
      caseContainerTypes: ['switch_body'],
      caseTypes: ['switch_case', 'switch_default'],
      defaultCaseTypes: ['switch_default'],
    },
    expressionKindByType: {
      string: 'literal',
      template_string: 'literal',
      number: 'literal',
      true: 'literal',
      false: 'literal',
      null: 'literal',
      undefined: 'literal',
      identifier: 'local-read',
      member_expression: 'member-read',
      subscript_expression: 'index-read',
      call_expression: 'call',
      new_expression: 'new',
      binary_expression: 'binary',
      unary_expression: 'unary',
      update_expression: 'unary',
      arrow_function: 'lambda',
      function_expression: 'lambda',
      as_expression: 'cast',
    },
    labelIdentifierTypes: ['statement_identifier'],
  };
}

function pythonTable(): LanguageLoweringTable {
  return {
    language: Language.Python,
    loweringVersion: 'python-lowering-v1',
    blockTypes: ['block'],
    transparentWrapperTypes: [],
    statementKindByType: {
      if_statement: 'conditional',
      for_statement: 'loop',
      while_statement: 'loop',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      raise_statement: 'throw',
      try_statement: 'try',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      call: 'call',
      assignment: 'assignment',
      augmented_assignment: 'assignment',
      await: 'await',
      yield: 'yield',
    },
    clauses: {
      elseTypes: ['elif_clause', 'else_clause'],
      catchTypes: ['except_clause'],
      finallyTypes: ['finally_clause'],
      caseContainerTypes: [],
      caseTypes: [],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      string: 'literal',
      integer: 'literal',
      float: 'literal',
      true: 'literal',
      false: 'literal',
      none: 'literal',
      identifier: 'local-read',
      attribute: 'member-read',
      subscript: 'index-read',
      call: 'call',
      comparison_operator: 'binary',
      binary_operator: 'binary',
      boolean_operator: 'binary',
      unary_operator: 'unary',
      lambda: 'lambda',
    },
    labelIdentifierTypes: ['identifier'],
  };
}

function javaTable(): LanguageLoweringTable {
  return {
    language: Language.Java,
    loweringVersion: 'java-lowering-v1',
    blockTypes: ['block'],
    transparentWrapperTypes: ['parenthesized_expression'],
    statementKindByType: {
      local_variable_declaration: 'declaration',
      if_statement: 'conditional',
      for_statement: 'loop',
      enhanced_for_statement: 'loop',
      while_statement: 'loop',
      do_statement: 'loop',
      switch_expression: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      throw_statement: 'throw',
      try_statement: 'try',
      labeled_statement: 'label',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      method_invocation: 'call',
      object_creation_expression: 'call',
      assignment_expression: 'assignment',
      update_expression: 'assignment',
    },
    clauses: {
      elseTypes: [],
      catchTypes: ['catch_clause'],
      finallyTypes: ['finally_clause'],
      caseContainerTypes: [],
      caseTypes: ['switch_block_statement_group'],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      string_literal: 'literal',
      decimal_integer_literal: 'literal',
      decimal_floating_point_literal: 'literal',
      true: 'literal',
      false: 'literal',
      null_literal: 'literal',
      identifier: 'local-read',
      field_access: 'member-read',
      array_access: 'index-read',
      method_invocation: 'call',
      object_creation_expression: 'new',
      binary_expression: 'binary',
      unary_expression: 'unary',
      cast_expression: 'cast',
      instanceof_expression: 'type-test',
      lambda_expression: 'lambda',
    },
    labelIdentifierTypes: ['identifier'],
  };
}

function goTable(): LanguageLoweringTable {
  return {
    language: Language.Go,
    loweringVersion: 'go-lowering-v1',
    blockTypes: ['block'],
    transparentWrapperTypes: [],
    statementKindByType: {
      short_var_declaration: 'declaration',
      var_declaration: 'declaration',
      assignment_statement: 'assignment',
      if_statement: 'conditional',
      for_statement: 'loop',
      expression_switch_statement: 'switch',
      type_switch_statement: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      defer_statement: 'call',
      go_statement: 'call',
      labeled_statement: 'label',
      goto_statement: 'goto',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      call_expression: 'call',
    },
    clauses: {
      elseTypes: [],
      catchTypes: [],
      finallyTypes: [],
      caseContainerTypes: [],
      caseTypes: ['expression_case', 'type_case'],
      defaultCaseTypes: ['default_case'],
    },
    expressionKindByType: {
      interpreted_string_literal: 'literal',
      raw_string_literal: 'literal',
      int_literal: 'literal',
      float_literal: 'literal',
      true: 'literal',
      false: 'literal',
      nil: 'literal',
      identifier: 'local-read',
      selector_expression: 'member-read',
      index_expression: 'index-read',
      call_expression: 'call',
      binary_expression: 'binary',
      unary_expression: 'unary',
      func_literal: 'lambda',
      type_assertion_expression: 'type-test',
    },
    labelIdentifierTypes: ['label_name', 'identifier'],
  };
}

function cFamilyTable(language: Language, adapterId: string, extraTransparent: readonly string[] = []): LanguageLoweringTable {
  return {
    language,
    loweringVersion: `${adapterId}-lowering-v1`,
    blockTypes: ['compound_statement'],
    transparentWrapperTypes: ['parenthesized_expression', ...extraTransparent],
    statementKindByType: {
      declaration: 'declaration',
      if_statement: 'conditional',
      for_statement: 'loop',
      while_statement: 'loop',
      do_statement: 'loop',
      switch_statement: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      throw_statement: 'throw',
      try_statement: 'try',
      labeled_statement: 'label',
      goto_statement: 'goto',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      call_expression: 'call',
      assignment_expression: 'assignment',
      update_expression: 'assignment',
    },
    clauses: {
      elseTypes: ['else_clause'],
      catchTypes: ['catch_clause'],
      finallyTypes: [],
      caseContainerTypes: ['compound_statement'],
      caseTypes: ['case_statement'],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      string_literal: 'literal',
      number_literal: 'literal',
      true: 'literal',
      false: 'literal',
      null: 'literal',
      nullptr: 'literal',
      identifier: 'local-read',
      field_expression: 'member-read',
      subscript_expression: 'index-read',
      call_expression: 'call',
      binary_expression: 'binary',
      unary_expression: 'unary',
      cast_expression: 'cast',
      lambda_expression: 'lambda',
      new_expression: 'new',
    },
    labelIdentifierTypes: ['statement_identifier'],
  };
}

function csharpTable(): LanguageLoweringTable {
  return {
    language: Language.CSharp,
    loweringVersion: 'csharp-lowering-v1',
    blockTypes: ['block'],
    transparentWrapperTypes: [],
    statementKindByType: {
      local_declaration_statement: 'declaration',
      if_statement: 'conditional',
      for_statement: 'loop',
      foreach_statement: 'loop',
      while_statement: 'loop',
      do_statement: 'loop',
      switch_statement: 'switch',
      switch_expression: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      throw_statement: 'throw',
      try_statement: 'try',
      labeled_statement: 'label',
      goto_statement: 'goto',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      invocation_expression: 'call',
      object_creation_expression: 'call',
      assignment_expression: 'assignment',
      postfix_unary_expression: 'assignment',
    },
    clauses: {
      elseTypes: ['else_clause'],
      catchTypes: ['catch_clause'],
      finallyTypes: ['finally_clause'],
      caseContainerTypes: [],
      caseTypes: ['switch_section'],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      string_literal: 'literal',
      integer_literal: 'literal',
      real_literal: 'literal',
      boolean_literal: 'literal',
      null_literal: 'literal',
      identifier: 'local-read',
      member_access_expression: 'member-read',
      element_access_expression: 'index-read',
      invocation_expression: 'call',
      object_creation_expression: 'new',
      binary_expression: 'binary',
      prefix_unary_expression: 'unary',
      postfix_unary_expression: 'unary',
      cast_expression: 'cast',
      is_expression: 'type-test',
      lambda_expression: 'lambda',
    },
    labelIdentifierTypes: ['identifier'],
  };
}

function rustTable(): LanguageLoweringTable {
  return {
    language: Language.Rust,
    loweringVersion: 'rust-lowering-v1',
    blockTypes: ['block'],
    transparentWrapperTypes: ['expression_statement'],
    statementKindByType: {
      let_declaration: 'declaration',
      if_expression: 'conditional',
      for_expression: 'loop',
      while_expression: 'loop',
      loop_expression: 'loop',
      match_expression: 'switch',
      break_expression: 'break',
      continue_expression: 'continue',
      return_expression: 'return',
      call_expression: 'call',
      assignment_expression: 'assignment',
      compound_assignment_expr: 'assignment',
      macro_invocation: 'call',
    },
    expressionStatementInnerKind: {},
    clauses: {
      elseTypes: ['else_clause'],
      catchTypes: [],
      finallyTypes: [],
      caseContainerTypes: ['match_block'],
      caseTypes: ['match_arm'],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      string_literal: 'literal',
      integer_literal: 'literal',
      float_literal: 'literal',
      boolean_literal: 'literal',
      identifier: 'local-read',
      field_expression: 'member-read',
      index_expression: 'index-read',
      call_expression: 'call',
      binary_expression: 'binary',
      unary_expression: 'unary',
      closure_expression: 'lambda',
      as_expression: 'cast',
      macro_invocation: 'call',
    },
    labelIdentifierTypes: ['label'],
  };
}

function phpTable(): LanguageLoweringTable {
  return {
    language: Language.PHP,
    loweringVersion: 'php-lowering-v1',
    blockTypes: ['compound_statement'],
    transparentWrapperTypes: ['parenthesized_expression'],
    statementKindByType: {
      if_statement: 'conditional',
      for_statement: 'loop',
      foreach_statement: 'loop',
      while_statement: 'loop',
      do_statement: 'loop',
      switch_statement: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      try_statement: 'try',
      echo_statement: 'call',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      function_call_expression: 'call',
      member_call_expression: 'call',
      assignment_expression: 'assignment',
      augmented_assignment_expression: 'assignment',
      update_expression: 'assignment',
      throw_expression: 'throw',
    },
    clauses: {
      elseTypes: ['else_clause', 'else_if_clause'],
      catchTypes: ['catch_clause'],
      finallyTypes: ['finally_clause'],
      caseContainerTypes: ['compound_statement'],
      caseTypes: ['case_statement'],
      defaultCaseTypes: ['default_statement'],
    },
    expressionKindByType: {
      string: 'literal',
      integer: 'literal',
      float: 'literal',
      boolean: 'literal',
      null: 'literal',
      variable_name: 'local-read',
      member_access_expression: 'member-read',
      subscript_expression: 'index-read',
      function_call_expression: 'call',
      member_call_expression: 'call',
      object_creation_expression: 'new',
      binary_expression: 'binary',
      unary_op_expression: 'unary',
      cast_expression: 'cast',
      anonymous_function_creation_expression: 'lambda',
      arrow_function: 'lambda',
    },
    labelIdentifierTypes: ['name'],
  };
}

function kotlinTable(): LanguageLoweringTable {
  return {
    language: Language.Kotlin,
    loweringVersion: 'kotlin-lowering-v1',
    blockTypes: ['statements'],
    transparentWrapperTypes: ['statement'],
    statementKindByType: {
      property_declaration: 'declaration',
      if_expression: 'conditional',
      for_statement: 'loop',
      while_statement: 'loop',
      when_expression: 'switch',
      return_expression: 'return',
      throw_expression: 'throw',
      try_expression: 'try',
      call_expression: 'call',
    },
    expressionStatementInnerKind: {},
    clauses: {
      elseTypes: [],
      catchTypes: ['catch_block'],
      finallyTypes: ['finally_block'],
      caseContainerTypes: [],
      caseTypes: ['when_entry'],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      string_literal: 'literal',
      integer_literal: 'literal',
      real_literal: 'literal',
      boolean_literal: 'literal',
      simple_identifier: 'local-read',
      navigation_expression: 'member-read',
      indexing_expression: 'index-read',
      call_expression: 'call',
      binary_expression: 'binary',
      prefix_expression: 'unary',
      postfix_expression: 'unary',
      lambda_literal: 'lambda',
      as_expression: 'cast',
    },
    labelIdentifierTypes: ['label'],
  };
}

function rubyTable(): LanguageLoweringTable {
  return {
    language: Language.Ruby,
    loweringVersion: 'ruby-lowering-v1',
    blockTypes: ['body_statement', 'do_block'],
    transparentWrapperTypes: ['then', 'do', 'in', 'if_modifier'],
    statementKindByType: {
      if: 'conditional',
      elsif: 'conditional',
      for: 'loop',
      while: 'loop',
      until: 'loop',
      case: 'switch',
      break: 'break',
      next: 'continue',
      return: 'return',
      begin: 'try',
      assignment: 'assignment',
      operator_assignment: 'assignment',
      call: 'call',
    },
    expressionStatementInnerKind: {},
    clauses: {
      elseTypes: ['else'],
      catchTypes: ['rescue'],
      finallyTypes: ['ensure'],
      caseContainerTypes: [],
      caseTypes: ['when'],
      defaultCaseTypes: ['else'],
    },
    expressionKindByType: {
      string: 'literal',
      integer: 'literal',
      float: 'literal',
      true: 'literal',
      false: 'literal',
      nil: 'literal',
      identifier: 'local-read',
      call: 'call',
      binary: 'binary',
      unary: 'unary',
      lambda: 'lambda',
    },
    labelIdentifierTypes: ['identifier'],
  };
}

function swiftTable(): LanguageLoweringTable {
  return {
    language: Language.Swift,
    loweringVersion: 'swift-lowering-v1',
    blockTypes: ['statements'],
    transparentWrapperTypes: [],
    statementKindByType: {
      property_declaration: 'declaration',
      if_statement: 'conditional',
      for_statement: 'loop',
      while_statement: 'loop',
      switch_statement: 'switch',
      do_statement: 'try',
      call_expression: 'call',
      directly_assignable_expression: 'assignment',
    },
    expressionStatementInnerKind: {},
    clauses: {
      elseTypes: [],
      catchTypes: ['catch_block'],
      finallyTypes: [],
      caseContainerTypes: [],
      caseTypes: ['switch_entry'],
      defaultCaseTypes: [],
    },
    expressionKindByType: {
      integer_literal: 'literal',
      line_string_literal: 'literal',
      boolean_literal: 'literal',
      simple_identifier: 'local-read',
      navigation_expression: 'member-read',
      call_expression: 'call',
      comparison_expression: 'binary',
      additive_expression: 'binary',
      multiplicative_expression: 'binary',
      equality_expression: 'binary',
      lambda_literal: 'lambda',
      as_expression: 'cast',
    },
    labelIdentifierTypes: ['statement_label'],
    collapsedControlTransferTypes: ['control_transfer_statement'],
    disambiguateByLeadingText: CONTROL_TRANSFER_BY_LEADING_WORD,
  };
}

/**
 * Dart's bundled tree-sitter grammar could not be loaded in this
 * environment (see file header) so this table follows well-established
 * dart-lang grammar conventions rather than a verified parse. Treated as
 * lower-confidence: the capability descriptor marks Dart 'partial'.
 */
function dartTable(): LanguageLoweringTable {
  return {
    language: Language.Dart,
    loweringVersion: 'dart-lowering-v1',
    blockTypes: ['block'],
    transparentWrapperTypes: ['parenthesized_expression'],
    statementKindByType: {
      if_statement: 'conditional',
      for_statement: 'loop',
      while_statement: 'loop',
      do_statement: 'loop',
      switch_statement: 'switch',
      break_statement: 'break',
      continue_statement: 'continue',
      return_statement: 'return',
      throw_statement: 'throw',
      try_statement: 'try',
      labeled_statement: 'label',
    },
    expressionStatementWrapperType: 'expression_statement',
    expressionStatementInnerKind: {
      call_expression: 'call',
      assignment_expression: 'assignment',
    },
    clauses: {
      elseTypes: ['else_clause'],
      catchTypes: ['catch_clause'],
      finallyTypes: ['finally_clause'],
      caseContainerTypes: ['block'],
      caseTypes: ['switch_case'],
      defaultCaseTypes: ['switch_default'],
    },
    expressionKindByType: {
      string_literal: 'literal',
      decimal_integer_literal: 'literal',
      true: 'literal',
      false: 'literal',
      null_literal: 'literal',
      identifier: 'local-read',
      call_expression: 'call',
      binary_expression: 'binary',
    },
    labelIdentifierTypes: ['identifier'],
  };
}

const TABLE_BY_LANGUAGE: Readonly<Partial<Record<Language, LanguageLoweringTable>>> = {
  [Language.TypeScript]: jsFamilyTable(Language.TypeScript, 'typescript'),
  [Language.JavaScript]: jsFamilyTable(Language.JavaScript, 'javascript'),
  [Language.Python]: pythonTable(),
  [Language.Java]: javaTable(),
  [Language.Go]: goTable(),
  [Language.C]: cFamilyTable(Language.C, 'c'),
  [Language.Cpp]: cFamilyTable(Language.Cpp, 'cpp', ['condition_clause']),
  [Language.CSharp]: csharpTable(),
  [Language.Rust]: rustTable(),
  [Language.PHP]: phpTable(),
  [Language.Kotlin]: kotlinTable(),
  [Language.Ruby]: rubyTable(),
  [Language.Swift]: swiftTable(),
  [Language.Dart]: dartTable(),
};

export function getLoweringTable(language: Language): LanguageLoweringTable | null {
  return TABLE_BY_LANGUAGE[language] ?? null;
}
