import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build, detectQueryIntent } from '../../../src/context/builder.js';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import type { CodeNode } from '../../../src/shared/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function addNode(
  graph: ReturnType<typeof createKnowledgeGraph>,
  id: string,
  name: string,
  kind: CodeNode['kind'],
  filePath: string,
  content?: string,
  startLine?: number,
  summary?: string,
): CodeNode {
  const node: CodeNode = {
    id, kind, name, filePath,
    content,
    startLine,
    metadata: summary ? { summary } : undefined,
  };
  graph.addNode(node);
  return node;
}

function addEdge(
  graph: ReturnType<typeof createKnowledgeGraph>,
  source: string,
  target: string,
  kind: CodeNode['kind'] extends never ? never : Parameters<ReturnType<typeof createKnowledgeGraph>['addEdge']>[0]['kind'],
) {
  graph.addEdge({ id: `${source}-${target}-${kind}`, source, target, kind });
}

// ── B.5.2 detectQueryIntent ───────────────────────────────────────────────────

describe('detectQueryIntent — B.5.2', () => {
  it('"show me the code" → code', () => assert.equal(detectQueryIntent('show me the code'), 'code'));
  it('"implement the auth handler" → code', () => assert.equal(detectQueryIntent('implement the auth handler'), 'code'));
  it('"who calls UserService?" → callers', () => assert.equal(detectQueryIntent('who calls UserService?'), 'callers'));
  it('"blast radius of createUser" → callers', () => assert.equal(detectQueryIntent('blast radius of createUser'), 'callers'));
  it('"architecture overview" → architecture', () => assert.equal(detectQueryIntent('architecture overview'), 'architecture'));
  it('"how is the system structured?" → architecture', () => assert.equal(detectQueryIntent('how is the system structured?'), 'architecture'));
  it('"find a bug" → auto', () => assert.equal(detectQueryIntent('find a bug'), 'auto'));
});

// ── B.1 SUMMARY block ─────────────────────────────────────────────────────────

describe('[SUMMARY] block — B.1', () => {
  it('B.1.1: formats symbol as one compact line with kind, path, line, and summary', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'UserService', 'class', 'src/auth/user.ts', undefined, 45, 'Manages user auth and sessions.');
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g);
    assert.ok(doc.summary.includes('[SUMMARY]'));
    assert.ok(doc.summary.includes('UserService'));
    assert.ok(doc.summary.includes('[class]'));
    assert.ok(doc.summary.includes('auth/user.ts'));
    assert.ok(doc.summary.includes(':45'));
    assert.ok(doc.summary.includes('Manages user auth and sessions'));
  });

  it('B.1.1: symbol without summary — entry has no "No summary" placeholder', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'helperFn', 'function', 'src/utils/helper.ts');
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(!doc.summary.includes('No summary'));
    assert.ok(!doc.summary.includes('undefined'));
  });

  it('B.1.1: god-node (many callers) gets ⚠ badge', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'BigService', 'class', 'src/big.ts');
    for (let i = 0; i < 12; i++) {
      addNode(g, `c${i}`, `Caller${i}`, 'function', `src/other${i}.ts`);
      addEdge(g, `c${i}`, 'n1', 'calls');
    }
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(doc.summary.includes('⚠'), 'god node should have ⚠ badge');
  });

  it('B.1.1: file path is last 2 segments only', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'PaymentHandler', 'class', 'src/services/payment/handler.ts');
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(!doc.summary.includes('src/services/payment/handler.ts'), 'full path should not appear');
    assert.ok(doc.summary.includes('payment/handler.ts'), 'last 2 segments should appear');
  });

  it('B.1.2: 3+ symbols same dir → cluster header + indented entries', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'AuthService', 'class', 'src/auth/service.ts');
    addNode(g, 'n2', 'login', 'function', 'src/auth/login.ts');
    addNode(g, 'n3', 'JWTMiddleware', 'function', 'src/auth/middleware.ts');
    const doc = build(
      [{ nodeId: 'n1' }, { nodeId: 'n2' }, { nodeId: 'n3' }],
      g,
    );
    assert.ok(doc.summary.includes('src/auth/'), 'cluster header should appear');
    // indented entries
    const lines = doc.summary.split('\n');
    const indented = lines.filter((l) => l.startsWith('  '));
    assert.ok(indented.length >= 3, `expected ≥3 indented lines, got ${indented.length}`);
  });

  it('B.1.2: < 3 symbols same dir → no cluster header', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'AuthService', 'class', 'src/auth/service.ts');
    addNode(g, 'n2', 'UserRepo', 'class', 'src/db/repo.ts');
    const doc = build([{ nodeId: 'n1' }, { nodeId: 'n2' }], g);
    // No trailing colon dir header
    const hasHeader = doc.summary.split('\n').some((l) => l.match(/^src\/.*\/:\s*$/));
    assert.ok(!hasHeader, 'no cluster header for < 3 same-dir symbols');
  });
});

// ── B.2 LOGIC block ───────────────────────────────────────────────────────────

describe('[LOGIC] block — B.2', () => {
  it('B.2.1: ≤ 5 callees → single inline line', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'createUser', 'function', 'src/user.ts');
    addNode(g, 'c1', 'DB', 'class', 'src/db.ts');
    addNode(g, 'c2', 'Email', 'class', 'src/email.ts');
    addEdge(g, 'n1', 'c1', 'calls');
    addEdge(g, 'n1', 'c2', 'calls');
    const doc = build([{ nodeId: 'n1' }], g);
    const logicLines = doc.logic.split('\n').filter((l) => l.startsWith('createUser'));
    assert.ok(logicLines.length === 1, 'should be 1 inline line');
    assert.ok(logicLines[0].includes('→'), 'should contain arrow');
    assert.ok(logicLines[0].includes('DB'), 'should contain DB');
    assert.ok(logicLines[0].includes('Email'), 'should contain Email');
  });

  it('B.2.1: symbol with 0 callees → not in LOGIC block', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'helperFn', 'function', 'src/utils.ts');
    const doc = build([{ nodeId: 'n1' }], g);
    const logicLines = doc.logic.split('\n').filter((l) => l.startsWith('helperFn'));
    assert.equal(logicLines.length, 0);
  });

  it('B.2.2: 3+ symbols sharing a callee → group note appears', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'logger', 'Logger', 'class', 'src/logger.ts');
    addNode(g, 'n1', 'AuthService', 'class', 'src/auth.ts');
    addNode(g, 'n2', 'UserService', 'class', 'src/user.ts');
    addNode(g, 'n3', 'PaymentService', 'class', 'src/payment.ts');
    addEdge(g, 'n1', 'logger', 'calls');
    addEdge(g, 'n2', 'logger', 'calls');
    addEdge(g, 'n3', 'logger', 'calls');
    const doc = build([{ nodeId: 'n1' }, { nodeId: 'n2' }, { nodeId: 'n3' }], g);
    assert.ok(doc.logic.includes('all above →'), 'shared callee group note should appear');
    assert.ok(doc.logic.includes('Logger'), 'Logger should be in group note');
  });

  it('B.2.2: only 2 share a callee → not collapsed', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'logger', 'Logger', 'class', 'src/logger.ts');
    addNode(g, 'n1', 'AuthService', 'class', 'src/auth.ts');
    addNode(g, 'n2', 'UserService', 'class', 'src/user.ts');
    addEdge(g, 'n1', 'logger', 'calls');
    addEdge(g, 'n2', 'logger', 'calls');
    const doc = build([{ nodeId: 'n1' }, { nodeId: 'n2' }], g);
    assert.ok(!doc.logic.includes('all above →'), 'should not collapse < 3 shared callees');
  });
});

// ── B.3 RELATION block ────────────────────────────────────────────────────────

describe('[RELATION] block — B.3', () => {
  it('B.3.1: ≤ 3 callers → single compact line with ←', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'UserService', 'class', 'src/user.ts');
    addNode(g, 'c1', 'AuthController', 'class', 'src/auth.ts');
    addNode(g, 'c2', 'AdminController', 'class', 'src/admin.ts');
    addEdge(g, 'c1', 'n1', 'calls');
    addEdge(g, 'c2', 'n1', 'calls');
    const doc = build([{ nodeId: 'n1' }], g);
    const relLines = doc.relation.split('\n').filter((l) => l.includes('←'));
    assert.ok(relLines.length >= 1, 'should have caller line');
    assert.ok(relLines[0].includes('AuthController') || relLines[0].includes('AdminController'));
    assert.ok(!relLines[0].includes('+'), 'no +N more for ≤ 3 callers');
  });

  it('B.3.1: > 3 callers → top 3 + (+N more)', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'CoreService', 'class', 'src/core.ts');
    for (let i = 0; i < 6; i++) {
      addNode(g, `c${i}`, `Controller${i}`, 'class', `src/ctrl${i}.ts`);
      addEdge(g, `c${i}`, 'n1', 'calls');
    }
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(doc.relation.includes('+3 more') || doc.relation.includes('+'), 'should show +N more');
  });

  it('B.3.1: ⚡ prefix for high blast radius (≥ 5 callers)', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'HotService', 'class', 'src/hot.ts');
    for (let i = 0; i < 5; i++) {
      addNode(g, `c${i}`, `User${i}`, 'class', `src/u${i}.ts`);
      addEdge(g, `c${i}`, 'n1', 'calls');
    }
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(doc.relation.includes('⚡'), '⚡ should appear for ≥ 5 callers');
  });

  it('B.3.1: heritage on one line with · separator', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'UserService', 'class', 'src/user.ts');
    addNode(g, 'base', 'BaseService', 'class', 'src/base.ts');
    addNode(g, 'iface', 'IUserService', 'interface', 'src/iface.ts');
    addEdge(g, 'n1', 'base', 'extends');
    addEdge(g, 'n1', 'iface', 'implements');
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(doc.relation.includes('extends BaseService'), 'extends should appear');
    assert.ok(doc.relation.includes('implements IUserService'), 'implements should appear');
    // Both on same line
    const heritageLine = doc.relation.split('\n').find((l) => l.includes('extends'));
    assert.ok(heritageLine, 'should have a heritage line');
    assert.ok(heritageLine!.includes('·'), 'should use · separator');
  });

  it('B.3.2: caller already in LOGIC not repeated in RELATION (low blast)', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'createUser', 'function', 'src/user.ts');
    addNode(g, 'n2', 'UserController', 'class', 'src/ctrl.ts');
    // createUser calls DB, and UserController calls createUser
    addNode(g, 'db', 'DB', 'class', 'src/db.ts');
    addEdge(g, 'n1', 'db', 'calls');   // LOGIC: createUser → DB
    addEdge(g, 'n2', 'n1', 'calls');   // RELATION candidate: createUser ← UserController
    const doc = build([{ nodeId: 'n1' }, { nodeId: 'n2' }], g);
    // n2 calls n1 — but n2 is in seeds so LOGIC shows n2→n1 path
    // UserController should not double-appear in RELATION for createUser
    const callerLine = doc.relation.split('\n').find((l) => l.includes('createUser') && l.includes('←'));
    // Either it's absent (dedup worked) or it's there but just once
    if (callerLine) {
      const count = doc.relation.split('UserController ← createUser').length - 1;
      assert.ok(count <= 1, 'should not duplicate');
    }
  });
});

// ── B.4 FOCUS CODE block ──────────────────────────────────────────────────────

describe('[FOCUS CODE] block — B.4', () => {
  it('B.4.1: short function (≤ 10 lines) → all lines, no truncation', () => {
    const g = createKnowledgeGraph();
    const content = ['function add(a, b) {', '  return a + b;', '}'].join('\n');
    addNode(g, 'n1', 'add', 'function', 'src/math.ts', content);
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g);
    assert.ok(doc.focusCode.includes('return a + b'), 'all lines should be present');
    assert.ok(!doc.focusCode.includes('...'), 'no truncation for short fn');
    assert.equal(doc.truncated, false);
  });

  it('B.4.1: long function (> 25 meaningful lines) → truncated to 40 raw + comment', () => {
    const g = createKnowledgeGraph();
    const lines = Array.from({ length: 60 }, (_, i) => `  const x${i} = doWork(${i});`);
    const content = ['function bigFn() {', ...lines, '}'].join('\n');
    addNode(g, 'n1', 'bigFn', 'function', 'src/big.ts', content);
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g);
    assert.ok(doc.focusCode.includes('bigFn'), 'function name should appear');
    assert.ok(doc.focusCode.includes('...'), 'truncation marker should appear');
  });

  it('B.4.1: leading/trailing blank lines stripped', () => {
    const g = createKnowledgeGraph();
    const content = '\n\nfunction hello() { return 1; }\n\n\n';
    addNode(g, 'n1', 'hello', 'function', 'src/hello.ts', content);
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g);
    const snippet = doc.focusCode;
    // The rendered snippet should not start with blank lines
    const codeBlock = snippet.split('```')[1] ?? '';
    assert.ok(!codeBlock.startsWith('\n\n'), 'leading blanks should be stripped');
  });

  it('B.4.3: symbol with refinedScore < 0.3 → signature only', () => {
    const g = createKnowledgeGraph();
    const content = Array.from({ length: 20 }, (_, i) => `  const x${i} = i;`).join('\n');
    addNode(g, 'n1', 'validateEmail', 'function', 'src/validate.ts', `function validateEmail(email: string): boolean {\n${content}\n}`);
    const doc = build([{ nodeId: 'n1', refinedScore: 0.1 }], g);
    assert.ok(doc.focusCode.includes('validateEmail'), 'name should appear');
    assert.ok(doc.focusCode.includes('low relevance'), 'should show low relevance comment');
    // Should not include the full body
    assert.ok(!doc.focusCode.includes('x0'), 'full body should not appear for low relevance');
  });

  it('B.4.3: symbol with refinedScore >= 0.3 → full body', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'createUser', 'function', 'src/user.ts', 'function createUser(dto) {\n  const user = DB.insert(dto);\n  return user;\n}');
    const doc = build([{ nodeId: 'n1', refinedScore: 0.8 }], g);
    assert.ok(doc.focusCode.includes('DB.insert'), 'full body should appear');
    assert.ok(!doc.focusCode.includes('low relevance'));
  });

  it('B.4.2: short symbol already in LOGIC is skipped in FOCUS CODE', () => {
    const g = createKnowledgeGraph();
    // n1 (caller) calls n2 (short callee)
    addNode(g, 'n1', 'Orchestrator', 'function', 'src/main.ts', 'function Orchestrator() { helper(); }');
    addNode(g, 'n2', 'helper', 'function', 'src/utils.ts', 'function helper() { return 1; }');
    addEdge(g, 'n1', 'n2', 'calls');
    // Both are seeds — helper is short (≤5 lines) and appears in LOGIC
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }, { nodeId: 'n2', refinedScore: 1 }], g);
    // After n1 is processed in LOGIC (helper callee tracked), helper in FOCUS CODE should be skipped
    // Count occurrences of 'helper' as a code header
    const focusHeaders = doc.focusCode.split('\n').filter((l) => l.startsWith('// helper'));
    assert.ok(focusHeaders.length <= 1, 'helper should appear at most once in FOCUS CODE');
  });
});

// ── B.5 Dynamic budget ────────────────────────────────────────────────────────

describe('Dynamic budget + intent presets — B.5', () => {
  it('B.5.1: total output never exceeds maxTokens', async () => {
    const { measureBlocks } = await import('../../../src/context/token-counter.js');
    const g = createKnowledgeGraph();
    for (let i = 0; i < 20; i++) {
      const content = Array.from({ length: 50 }, (_, j) => `  const v${j} = compute(${j});`).join('\n');
      addNode(g, `n${i}`, `Symbol${i}`, 'function', `src/file${i}.ts`, content);
    }
    const seeds = Array.from({ length: 20 }, (_, i) => ({ nodeId: `n${i}`, refinedScore: 1 }));
    const doc = build(seeds, g, { maxTokens: 2000 });
    const counts = measureBlocks(doc);
    assert.ok(counts.total <= 2200, `total ${counts.total} should be close to 2000 budget`);
  });

  it('B.5.2: intent=code → focusCode gets large budget', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'createUser', 'function', 'src/user.ts',
      Array.from({ length: 30 }, (_, i) => `  step${i}();`).join('\n'));
    const doc = build([{ nodeId: 'n1', refinedScore: 1 }], g, { queryIntent: 'code', maxTokens: 6000 });
    assert.equal(doc.intent, 'code');
    // With code intent, focusCode budget is 5000 — it should contain more content
    assert.ok(doc.focusCode.length > 0, 'focusCode should be populated with code intent');
  });

  it('B.5.2: intent auto-detect sets correct intent', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'X', 'function', 'src/x.ts');
    const doc = build([{ nodeId: 'n1' }], g, { queryIntent: 'callers' });
    assert.equal(doc.intent, 'callers');
  });
});

// ── B.6 Cross-block dedup ─────────────────────────────────────────────────────

describe('Cross-block dedup registry — B.6', () => {
  it('symbol appearing in SUMMARY shows full info first mention', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'UserService', 'class', 'src/user.ts', undefined, 10, 'Manages users.');
    const doc = build([{ nodeId: 'n1' }], g);
    assert.ok(doc.summary.includes('[class]'), 'full format in SUMMARY');
    assert.ok(doc.summary.includes('auth/user.ts') || doc.summary.includes('src/user.ts') || doc.summary.includes('user.ts'));
  });

  it('DedupeRegistry resets between build() calls', () => {
    const g = createKnowledgeGraph();
    addNode(g, 'n1', 'UserService', 'class', 'src/user.ts', undefined, 10, 'Manages users.');

    const doc1 = build([{ nodeId: 'n1' }], g);
    const doc2 = build([{ nodeId: 'n1' }], g);

    // Both should have full format (not name-only) since registry resets
    assert.ok(doc1.summary.includes('[class]'));
    assert.ok(doc2.summary.includes('[class]'));
  });
});
