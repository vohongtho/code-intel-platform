import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SKELETON_CAPABILITIES, getSkeletonCapability, skeletonize } from '../../../src/context/skeletonizer.js';
import { parseSource } from '../../../src/parsing/index.js';
import { Language } from '../../../src/shared/index.js';

const TS_FUNCTION = `export async function login(user: string, pass: string): Promise<Session> {
  const started = Date.now();
  const label = \`user-\${user}\`;
  const normalized = label.trim().toLowerCase().replace(/\\s+/g, '-').slice(0, 64);
  const metrics = { attempts: 0, failures: 0, lastSeen: started, tags: [normalized, label] };
  let delay = metrics.attempts * 100 + metrics.failures * 250 + (metrics.lastSeen % 7);
  if (!user) {
    throw new Error('missing user');
  }
  const record = await store.find(user);
  for (const hook of hooks) {
    await hook.before(record);
    counter += 1;
  }
  logger.info(label);
  return persistSession(record, started);
}`;

describe('skeletonizer — capability declarations', () => {
  it('declares only fixture-backed rows as enabled', () => {
    for (const row of SKELETON_CAPABILITIES) assert.equal(row.enabled, true);
    assert.ok(getSkeletonCapability(Language.TypeScript));
    assert.equal(getSkeletonCapability(Language.Go), undefined);
    assert.equal(getSkeletonCapability(undefined), undefined);
  });
});

describe('skeletonizer — TypeScript', () => {
  it('keeps declaration, headings, calls, return/throw and marks omissions', async () => {
    const result = await skeletonize({ content: TS_FUNCTION, filePath: 'src/auth.ts', nodeKind: 'function' });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.match(result.text, /^export async function login\(user: string, pass: string\): Promise<Session> \{/);
    assert.match(result.text, /if \(!user\) \{/);
    assert.match(result.text, /throw new Error\('missing user'\);/);
    assert.match(result.text, /for \(const hook of hooks\) \{/);
    assert.match(result.text, /await hook\.before\(record\);/);
    assert.match(result.text, /return persistSession\(record, started\);/);
    assert.match(result.text, /\/\/ … \d+ statements? omitted/);
    assert.ok(result.omittedStatements > 0);
    assert.ok(result.text.length < TS_FUNCTION.length);
    const tree = await parseSource(Language.TypeScript, result.text);
    assert.equal(tree?.rootNode.hasError, false, 'skeleton must itself parse');
  });

  it('handles class methods that only parse inside a class', async () => {
    const method = `async handle(req: Request): Promise<void> {
    const body = req.body;
    validate(body);
    this.count++;
    return this.save(body);
  }`;
    const result = await skeletonize({ content: method, filePath: 'src/h.ts', nodeKind: 'method' });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
      assert.match(result.text, /^async handle\(req: Request\): Promise<void> \{/);
      assert.match(result.text, /validate\(body\);/);
    }
  });

  it('preserves Unicode identifiers and strings byte-for-byte', async () => {
    const source = `function grüßen(名前: string) {
  const prefix = 'こんにちは — 🌍';
  console.log(名前, prefix);
  const x = 1;
  return 名前 + '✓';
}`;
    const result = await skeletonize({ content: source, filePath: 'src/u.ts', nodeKind: 'function' });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
      assert.match(result.text, /function grüßen\(名前: string\) \{/);
      assert.match(result.text, /console\.log\(名前, prefix\);/);
      assert.match(result.text, /return 名前 \+ '✓';/);
    }
  });

  it('does not inject statements that were not in the source', async () => {
    const result = await skeletonize({ content: TS_FUNCTION, filePath: 'src/auth.ts', nodeKind: 'function' });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    for (const line of result.text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed === '}') continue;
      if (/\{$/.test(trimmed)) continue; // headings are source prefixes
      assert.ok(TS_FUNCTION.includes(trimmed), `fabricated line: ${trimmed}`);
    }
  });

  it('reports nothing-to-compress for empty bodies', async () => {
    const result = await skeletonize({ content: 'function noop() {}', filePath: 'src/n.ts', nodeKind: 'function' });
    assert.deepEqual(result.status === 'unsupported' && result.reason, 'nothing-to-compress');
  });

  it('refuses arrow functions with expression bodies', async () => {
    const result = await skeletonize({ content: 'const f = (x: number) => x + 1;', filePath: 'src/a.ts', nodeKind: 'function' });
    assert.equal(result.status, 'unsupported');
  });

  it('refuses unparseable source instead of guessing', async () => {
    const result = await skeletonize({ content: 'function broken( {{{ ', filePath: 'src/b.ts', nodeKind: 'function' });
    assert.equal(result.status, 'unsupported');
    if (result.status === 'unsupported') assert.equal(result.reason, 'parse-error');
  });
});

describe('skeletonizer — JavaScript', () => {
  it('skeletonizes plain functions', async () => {
    const source = `function run(job) {
  const t = Date.now();
  prepare(job);
  if (job.fatal) {
    throw new Error('fatal');
  }
  const u = t + 1;
  return finish(job, u);
}`;
    const result = await skeletonize({ content: source, filePath: 'src/run.js', nodeKind: 'function' });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') assert.match(result.text, /prepare\(job\);/);
  });
});

describe('skeletonizer — Python', () => {
  const PY = `def process(items, flag):
    total = 0
    cleaned = [i for i in items if i]
    if flag:
        audit(items)
        raise ValueError("bad")
    for item in cleaned:
        total += item.value
        notify(item)
    return summarize(total)`;

  it('keeps headings, calls, return/raise and parses cleanly', async () => {
    const result = await skeletonize({ content: PY, filePath: 'svc.py', nodeKind: 'function' });
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.match(result.text, /^def process\(items, flag\):/);
    assert.match(result.text, /if flag:/);
    assert.match(result.text, /raise ValueError\("bad"\)/);
    assert.match(result.text, /return summarize\(total\)/);
    assert.match(result.text, /# … \d+ statements? omitted/);
    const tree = await parseSource(Language.Python, result.text);
    assert.equal(tree?.rootNode.hasError, false);
  });

  it('handles indented methods', async () => {
    const method = `    def save(self, record):
        record.touch()
        self.count += 1
        return self.store.put(record)`;
    const result = await skeletonize({ content: method, filePath: 'svc.py', nodeKind: 'method' });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') assert.match(result.text, /return self\.store\.put\(record\)/);
  });
});

describe('skeletonizer — Java', () => {
  it('skeletonizes overloaded sibling methods independently', async () => {
    const one = `public Result handle(String id) {
    int n = id.length();
    audit.record(id);
    return handle(id, n);
  }`;
    const two = `public Result handle(String id, int n) {
    String x = id + n;
    if (n < 0) {
      throw new IllegalArgumentException("n");
    }
    return repo.load(x);
  }`;
    const a = await skeletonize({ content: one, filePath: 'A.java', nodeKind: 'method' });
    const b = await skeletonize({ content: two, filePath: 'A.java', nodeKind: 'method' });
    assert.equal(a.status, 'ok');
    assert.equal(b.status, 'ok');
    if (a.status === 'ok' && b.status === 'ok') {
      assert.match(a.text, /audit\.record\(id\);/);
      assert.match(b.text, /throw new IllegalArgumentException\("n"\);/);
      assert.notEqual(a.text, b.text);
    }
  });
});

describe('skeletonizer — unsupported', () => {
  it('reports language-unsupported (no destructive generic rewriting)', async () => {
    const result = await skeletonize({ content: 'func main() {\n  a()\n}', filePath: 'main.go', nodeKind: 'function' });
    assert.deepEqual(result, { status: 'unsupported', reason: 'language-unsupported', language: 'go' });
  });

  it('reports unknown file types', async () => {
    const result = await skeletonize({ content: 'x', filePath: 'notes.unknownext', nodeKind: 'function' });
    assert.equal(result.status, 'unsupported');
  });

  it('refuses non-function node kinds', async () => {
    const result = await skeletonize({ content: 'class A { m() { a(); } }', filePath: 'a.ts', nodeKind: 'class' });
    assert.equal(result.status === 'unsupported' && result.reason, 'node-kind-unsupported');
  });
});

describe('skeletonizer — capability matrix', () => {
  it('has one row per language and every unsupported row falls back safely', async () => {
    const { getSkeletonCapabilityMatrix } = await import('../../../src/context/skeletonizer.js');
    const matrix = getSkeletonCapabilityMatrix();
    assert.deepEqual(matrix.map((row) => row.language).sort(), Object.values(Language).sort());
    const samples: Record<string, string> = { go: 'a.go', rust: 'a.rs', c: 'a.c', cpp: 'a.cpp', csharp: 'a.cs', php: 'a.php', kotlin: 'a.kt', ruby: 'a.rb', swift: 'a.swift', dart: 'a.dart', html: 'a.html' };
    for (const row of matrix) {
      if (row.status === 'supported') {
        assert.equal(row.fallback, 'none');
        assert.ok(row.preserves.length > 0);
        continue;
      }
      assert.equal(row.fallback, 'snippet-or-signature');
      const result = await skeletonize({ content: 'function x() {\n  a();\n}', filePath: samples[row.language] ?? `a.${row.language}`, nodeKind: 'function' });
      assert.deepEqual(result.status === 'unsupported' && result.reason, 'language-unsupported', row.language);
    }
    assert.deepEqual(matrix.filter((row) => row.status === 'supported').map((row) => row.language).sort(), ['java', 'javascript', 'python', 'typescript']);
  });
});
