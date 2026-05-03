/**
 * GQL Parser — Graph Query Language
 *
 * Supported syntax:
 *   FIND function WHERE name CONTAINS "auth"
 *   FIND * WHERE kind IN [function, method] LIMIT 50
 *   TRAVERSE CALLS FROM "handleLogin" DEPTH 3
 *   PATH FROM "createUser" TO "sendEmail"
 *   COUNT function GROUP BY cluster
 */

// ── Token types ───────────────────────────────────────────────────────────────

export type TokenKind =
  | 'KEYWORD'       // FIND, TRAVERSE, PATH, COUNT, WHERE, FROM, TO, IN, BY, AND, NOT
  | 'IDENT'         // identifiers (kind names, property names, edge kind names)
  | 'STRING'        // "quoted" or 'quoted' string
  | 'NUMBER'        // integer
  | 'LBRACKET'      // [
  | 'RBRACKET'      // ]
  | 'OPERATOR'      // =, !=, CONTAINS, STARTS_WITH
  | 'STAR'          // *
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;   // character offset in input
}

// ── AST Node types ────────────────────────────────────────────────────────────

export type NodeKindFilter = string | '*';

export type WhereOperator = '=' | '!=' | 'CONTAINS' | 'STARTS_WITH' | 'IN';

export interface WhereExpr {
  property: string;
  operator: WhereOperator;
  value: string | string[];  // string for =, !=, CONTAINS, STARTS_WITH; string[] for IN
}

export interface WhereClause {
  exprs: WhereExpr[];   // joined with AND
}

export interface FindStatement {
  type: 'FIND';
  target: NodeKindFilter;   // '*' or a specific kind
  where?: WhereClause;
  limit?: number;
  offset?: number;
}

export interface TraverseStatement {
  type: 'TRAVERSE';
  edgeKind: string;   // CALLS, IMPORTS, etc.
  from: string;       // starting node name
  depth?: number;     // default 5
  direction?: 'OUTGOING' | 'INCOMING' | 'BOTH';  // default OUTGOING
}

export interface PathStatement {
  type: 'PATH';
  from: string;
  to: string;
}

export interface CountStatement {
  type: 'COUNT';
  target: NodeKindFilter;
  where?: WhereClause;
  groupBy?: string;
}

export type QueryAST =
  | FindStatement
  | TraverseStatement
  | PathStatement
  | CountStatement;

export interface GQLParseError {
  type: 'GQLParseError';
  message: string;
  pos: number;
  expected?: string;
  got?: string;
}

export function isGQLParseError(v: QueryAST | GQLParseError): v is GQLParseError {
  return (v as GQLParseError).type === 'GQLParseError';
}

// ── Lexer ─────────────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  'FIND', 'TRAVERSE', 'PATH', 'COUNT',
  'WHERE', 'FROM', 'TO', 'IN', 'BY',
  'AND', 'NOT', 'LIMIT', 'OFFSET',
  'DEPTH', 'GROUP', 'CONTAINS', 'STARTS_WITH',
  'CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS',
  'HAS_MEMBER', 'ACCESSES', 'OVERRIDES', 'BELONGS_TO',
  'STEP_OF', 'HANDLES', 'CONTAINS_EDGE',
  'OUTGOING', 'INCOMING', 'BOTH',
]);

function tokenize(input: string): Token[] | GQLParseError {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(input[i]!)) { i++; continue; }

    // Skip comments (#)
    if (input[i] === '#') {
      while (i < len && input[i] !== '\n') i++;
      continue;
    }

    const pos = i;

    // Quoted strings: double or single quotes
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i]!;
      i++;
      let str = '';
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\') {
          i++;
          if (i < len) {
            const esc = input[i]!;
            str += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
            i++;
          }
        } else {
          str += input[i++];
        }
      }
      if (i >= len) {
        return { type: 'GQLParseError', message: `Unterminated string at position ${pos}`, pos };
      }
      i++; // consume closing quote
      tokens.push({ kind: 'STRING', value: str, pos });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(input[i]!)) {
      let num = '';
      while (i < len && /[0-9]/.test(input[i]!)) num += input[i++];
      tokens.push({ kind: 'NUMBER', value: num, pos });
      continue;
    }

    // Brackets
    if (input[i] === '[') { tokens.push({ kind: 'LBRACKET', value: '[', pos }); i++; continue; }
    if (input[i] === ']') { tokens.push({ kind: 'RBRACKET', value: ']', pos }); i++; continue; }

    // Star
    if (input[i] === '*') { tokens.push({ kind: 'STAR', value: '*', pos }); i++; continue; }

    // Operators: !=
    if (input[i] === '!' && input[i + 1] === '=') {
      tokens.push({ kind: 'OPERATOR', value: '!=', pos });
      i += 2;
      continue;
    }
    // Operator: =
    if (input[i] === '=') {
      tokens.push({ kind: 'OPERATOR', value: '=', pos });
      i++;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(input[i]!)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(input[i]!)) ident += input[i++];
      const upper = ident.toUpperCase();
      if (upper === 'CONTAINS' || upper === 'STARTS_WITH' || upper === 'IN') {
        tokens.push({ kind: 'OPERATOR', value: upper, pos });
      } else if (KEYWORDS.has(upper)) {
        tokens.push({ kind: 'KEYWORD', value: upper, pos });
      } else {
        tokens.push({ kind: 'IDENT', value: ident, pos });
      }
      continue;
    }

    // Comma (used in IN lists)
    if (input[i] === ',') { i++; continue; }  // skip commas

    return {
      type: 'GQLParseError',
      message: `Unexpected character '${input[i]}' at position ${i}`,
      pos: i,
    };
  }

  tokens.push({ kind: 'EOF', value: '', pos: len });
  return tokens;
}

// ── Parser ────────────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private consume(): Token {
    return this.tokens[this.pos++]!;
  }

  private expect(kind: TokenKind, value?: string): Token | GQLParseError {
    const tok = this.peek();
    if (tok.kind !== kind) {
      return {
        type: 'GQLParseError',
        message: `Expected ${value ?? kind} but got '${tok.value}' at position ${tok.pos}`,
        pos: tok.pos,
        expected: value ?? kind,
        got: tok.value,
      };
    }
    if (value !== undefined && tok.value !== value) {
      return {
        type: 'GQLParseError',
        message: `Expected '${value}' but got '${tok.value}' at position ${tok.pos}`,
        pos: tok.pos,
        expected: value,
        got: tok.value,
      };
    }
    return this.consume();
  }

  private matchKeyword(...values: string[]): boolean {
    const tok = this.peek();
    return tok.kind === 'KEYWORD' && values.includes(tok.value);
  }

  private optionalKeyword(...values: string[]): Token | null {
    if (this.matchKeyword(...values)) {
      return this.consume();
    }
    return null;
  }

  /** Parse the node kind filter (IDENT, KEYWORD that's a kind, or STAR) */
  private parseNodeKind(): string | GQLParseError {
    const tok = this.peek();
    if (tok.kind === 'STAR') {
      this.consume();
      return '*';
    }
    if (tok.kind === 'IDENT' || tok.kind === 'KEYWORD') {
      this.consume();
      return tok.value.toLowerCase();
    }
    return {
      type: 'GQLParseError',
      message: `Expected node kind or '*' at position ${tok.pos}`,
      pos: tok.pos,
    };
  }

  /** Parse a string value (STRING or IDENT) */
  private parseStringValue(): string | GQLParseError {
    const tok = this.peek();
    if (tok.kind === 'STRING') {
      this.consume();
      return tok.value;
    }
    if (tok.kind === 'IDENT' || tok.kind === 'KEYWORD') {
      this.consume();
      return tok.value;
    }
    return {
      type: 'GQLParseError',
      message: `Expected string value at position ${tok.pos}`,
      pos: tok.pos,
    };
  }

  /** Parse an IN list: [ value, value, ... ] */
  private parseInList(): string[] | GQLParseError {
    const lb = this.expect('LBRACKET');
    if (isGQLParseError(lb as QueryAST | GQLParseError)) return lb as GQLParseError;

    const values: string[] = [];
    while (!this.matchKeyword() && this.peek().kind !== 'RBRACKET' && this.peek().kind !== 'EOF') {
      const v = this.parseStringValue();
      if (typeof v !== 'string') return v;
      values.push(v);
    }

    const rb = this.expect('RBRACKET');
    if (isGQLParseError(rb as QueryAST | GQLParseError)) return rb as GQLParseError;
    return values;
  }

  /** Parse a single WHERE expression */
  private parseWhereExpr(): WhereExpr | GQLParseError {
    // property name
    const propTok = this.peek();
    if (propTok.kind !== 'IDENT' && propTok.kind !== 'KEYWORD') {
      return {
        type: 'GQLParseError',
        message: `Expected property name at position ${propTok.pos}`,
        pos: propTok.pos,
      };
    }
    this.consume();
    const property = propTok.value.toLowerCase();

    // operator
    const opTok = this.peek();
    if (opTok.kind !== 'OPERATOR') {
      return {
        type: 'GQLParseError',
        message: `Expected operator (=, !=, CONTAINS, STARTS_WITH, IN) at position ${opTok.pos}`,
        pos: opTok.pos,
        expected: 'operator',
        got: opTok.value,
      };
    }
    this.consume();
    const operator = opTok.value as WhereOperator;

    // value
    if (operator === 'IN') {
      const list = this.parseInList();
      if (!Array.isArray(list)) return list as GQLParseError;
      return { property, operator, value: list };
    }

    const val = this.parseStringValue();
    if (typeof val !== 'string') return val;
    return { property, operator, value: val };
  }

  /** Parse WHERE clause: WHERE expr (AND expr)* */
  private parseWhereClause(): WhereClause | GQLParseError {
    const kw = this.expect('KEYWORD', 'WHERE');
    if (isGQLParseError(kw as QueryAST | GQLParseError)) return kw as GQLParseError;

    const exprs: WhereExpr[] = [];
    const first = this.parseWhereExpr();
    if ('type' in first && first.type === 'GQLParseError') return first;
    exprs.push(first as WhereExpr);

    while (this.matchKeyword('AND')) {
      this.consume(); // consume AND
      const expr = this.parseWhereExpr();
      if ('type' in expr && expr.type === 'GQLParseError') return expr;
      exprs.push(expr as WhereExpr);
    }

    return { exprs };
  }

  /** Parse FIND statement */
  private parseFindStatement(): FindStatement | GQLParseError {
    this.consume(); // consume FIND

    const kind = this.parseNodeKind();
    if (typeof kind !== 'string') return kind;

    let where: WhereClause | undefined;
    if (this.matchKeyword('WHERE')) {
      const w = this.parseWhereClause();
      if ('type' in w && (w as GQLParseError).type === 'GQLParseError') return w as GQLParseError;
      where = w as WhereClause;
    }

    let limit: number | undefined;
    let offset: number | undefined;

    // Parse optional LIMIT and OFFSET (in any order)
    while (this.matchKeyword('LIMIT', 'OFFSET')) {
      const kw = this.consume();
      const numTok = this.peek();
      if (numTok.kind !== 'NUMBER') {
        return {
          type: 'GQLParseError',
          message: `Expected number after ${kw.value} at position ${numTok.pos}`,
          pos: numTok.pos,
        };
      }
      this.consume();
      const n = parseInt(numTok.value, 10);
      if (kw.value === 'LIMIT') limit = n;
      else offset = n;
    }

    return { type: 'FIND', target: kind, where, limit, offset };
  }

  /** Parse TRAVERSE statement */
  private parseTraverseStatement(): TraverseStatement | GQLParseError {
    this.consume(); // consume TRAVERSE

    // Edge kind (CALLS, IMPORTS, etc.)
    const edgeTok = this.peek();
    if (edgeTok.kind !== 'KEYWORD' && edgeTok.kind !== 'IDENT') {
      return {
        type: 'GQLParseError',
        message: `Expected edge kind after TRAVERSE at position ${edgeTok.pos}`,
        pos: edgeTok.pos,
      };
    }
    this.consume();
    const edgeKind = edgeTok.value.toLowerCase();

    // FROM
    const fromKw = this.expect('KEYWORD', 'FROM');
    if (isGQLParseError(fromKw as QueryAST | GQLParseError)) return fromKw as GQLParseError;

    const fromVal = this.parseStringValue();
    if (typeof fromVal !== 'string') return fromVal;

    let depth: number | undefined;
    let direction: 'OUTGOING' | 'INCOMING' | 'BOTH' | undefined;

    // Optional DEPTH
    if (this.matchKeyword('DEPTH')) {
      this.consume();
      const numTok = this.peek();
      if (numTok.kind !== 'NUMBER') {
        return {
          type: 'GQLParseError',
          message: `Expected number after DEPTH at position ${numTok.pos}`,
          pos: numTok.pos,
        };
      }
      this.consume();
      depth = parseInt(numTok.value, 10);
    }

    // Optional direction
    if (this.matchKeyword('OUTGOING', 'INCOMING', 'BOTH')) {
      direction = this.consume().value as 'OUTGOING' | 'INCOMING' | 'BOTH';
    }

    return { type: 'TRAVERSE', edgeKind, from: fromVal, depth, direction };
  }

  /** Parse PATH statement */
  private parsePathStatement(): PathStatement | GQLParseError {
    this.consume(); // consume PATH

    const fromKw = this.expect('KEYWORD', 'FROM');
    if (isGQLParseError(fromKw as QueryAST | GQLParseError)) return fromKw as GQLParseError;

    const fromVal = this.parseStringValue();
    if (typeof fromVal !== 'string') return fromVal;

    const toKw = this.expect('KEYWORD', 'TO');
    if (isGQLParseError(toKw as QueryAST | GQLParseError)) return toKw as GQLParseError;

    const toVal = this.parseStringValue();
    if (typeof toVal !== 'string') return toVal;

    return { type: 'PATH', from: fromVal, to: toVal };
  }

  /** Parse COUNT statement */
  private parseCountStatement(): CountStatement | GQLParseError {
    this.consume(); // consume COUNT

    const kind = this.parseNodeKind();
    if (typeof kind !== 'string') return kind;

    let where: WhereClause | undefined;
    if (this.matchKeyword('WHERE')) {
      const w = this.parseWhereClause();
      if ('type' in w && (w as GQLParseError).type === 'GQLParseError') return w as GQLParseError;
      where = w as WhereClause;
    }

    let groupBy: string | undefined;
    if (this.matchKeyword('GROUP')) {
      this.consume(); // GROUP
      const byKw = this.expect('KEYWORD', 'BY');
      if (isGQLParseError(byKw as QueryAST | GQLParseError)) return byKw as GQLParseError;
      const propTok = this.peek();
      if (propTok.kind !== 'IDENT' && propTok.kind !== 'KEYWORD') {
        return {
          type: 'GQLParseError',
          message: `Expected property name after GROUP BY at position ${propTok.pos}`,
          pos: propTok.pos,
        };
      }
      this.consume();
      groupBy = propTok.value.toLowerCase();
    }

    return { type: 'COUNT', target: kind, where, groupBy };
  }

  parse(): QueryAST | GQLParseError {
    const tok = this.peek();

    if (tok.kind !== 'KEYWORD') {
      return {
        type: 'GQLParseError',
        message: `Expected FIND, TRAVERSE, PATH, or COUNT at position ${tok.pos}`,
        pos: tok.pos,
        expected: 'FIND | TRAVERSE | PATH | COUNT',
        got: tok.value,
      };
    }

    let result: QueryAST | GQLParseError;

    switch (tok.value) {
      case 'FIND':
        result = this.parseFindStatement();
        break;
      case 'TRAVERSE':
        result = this.parseTraverseStatement();
        break;
      case 'PATH':
        result = this.parsePathStatement();
        break;
      case 'COUNT':
        result = this.parseCountStatement();
        break;
      default:
        return {
          type: 'GQLParseError',
          message: `Unknown statement type '${tok.value}' at position ${tok.pos}`,
          pos: tok.pos,
          expected: 'FIND | TRAVERSE | PATH | COUNT',
          got: tok.value,
        };
    }

    if (isGQLParseError(result)) return result;

    // Ensure we consumed everything (allow trailing EOF)
    const remaining = this.peek();
    if (remaining.kind !== 'EOF') {
      return {
        type: 'GQLParseError',
        message: `Unexpected token '${remaining.value}' at position ${remaining.pos}`,
        pos: remaining.pos,
        got: remaining.value,
      };
    }

    return result;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a GQL query string into a QueryAST.
 * Returns a GQLParseError if parsing fails.
 */
export function parseGQL(input: string): QueryAST | GQLParseError {
  const tokens = tokenize(input.trim());
  if (!Array.isArray(tokens)) return tokens; // tokenization error
  const parser = new Parser(tokens);
  return parser.parse();
}
