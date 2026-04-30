/**
 * Parser Corpus Tests — Epic 1.1 (Tree-Sitter)
 *
 * Validates that the tree-sitter-powered symbol extraction pipeline produces
 * at least the expected set of symbols for every language fixture.
 * Falls back to the regex extractor when tree-sitter WASM is unavailable
 * (e.g. Swift, Kotlin, Dart).
 *
 * Golden files: tests/parser-corpus/golden/*.golden.json
 * Fixture files: tests/parser-corpus/fixtures/
 *
 * CI gate: ALL expectedSymbols in each golden file must be present in the
 * extracted output. Missing symbols → test failure → block merge.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, getLanguage, runQueryMatches } from '../../../src/parsing/index.js';
import { Language } from '../../../src/shared/index.js';
import type { NodeKind } from '../../../src/shared/index.js';
import {
  typescriptQueries,
  javascriptQueries,
  pythonQueries,
  javaQueries,
  goQueries,
  cQueries,
  cppQueries,
  csharpQueries,
  rustQueries,
  phpQueries,
  rubyQueries,
} from '../../../src/parsing/queries/index.js';

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR   = path.resolve(__dirname, '..', '..', '..', '..', 'tests', 'parser-corpus');
const FIXTURES_DIR = path.join(CORPUS_DIR, 'fixtures');
const GOLDEN_DIR   = path.join(CORPUS_DIR, 'golden');

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExpectedSymbol {
  kind: string;
  name: string;
  exported: boolean;
}

interface GoldenFile {
  language: string;
  fixture: string;
  description: string;
  expectedSymbols: ExpectedSymbol[];
  prohibitedSymbols?: string[];
  notes?: string[];
}

interface ExtractedSymbol {
  kind: string;
  name: string;
  exported: boolean;
  startLine: number;
  endLine: number;
}

// ── Capture-name → NodeKind map (mirrors parse-phase.ts) ──────────────────────

const CAPTURE_KIND: Record<string, NodeKind> = {
  'def.func':           'function',
  'def.func.decorated': 'function',
  'def.method':         'method',
  'def.method.static':  'method',
  'def.class':          'class',
  'def.class.object':   'class',
  'def.class.template': 'class',
  'def.impl':           'class',
  'def.interface':      'interface',
  'def.enum':           'enum',
  'def.struct':         'struct',
  'def.trait':          'trait',
  'def.type_alias':     'type_alias',
  'def.constant':       'constant',
  'def.namespace':      'namespace',
  'def.module':         'module',
  'def.property':       'property',
  'def.var':            'variable',
  'def.constructor':    'constructor',
};

function captureKind(name: string): NodeKind | null {
  if (CAPTURE_KIND[name]) return CAPTURE_KIND[name];
  const base = name.replace(/\.name$/, '');
  return CAPTURE_KIND[base] ?? null;
}

// ── Extension → Language ──────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, Language> = {
  '.ts': Language.TypeScript, '.tsx': Language.TypeScript,
  '.js': Language.JavaScript, '.mjs': Language.JavaScript,
  '.py': Language.Python,
  '.go': Language.Go,
  '.rs': Language.Rust,
  '.java': Language.Java,
  '.rb': Language.Ruby,
  '.php': Language.PHP,
  '.cs': Language.CSharp,
  '.swift': Language.Swift,
  '.dart': Language.Dart,
  '.c': Language.C,
  '.cpp': Language.Cpp,
  '.kt': Language.Kotlin,
};

const LANG_QUERIES: Partial<Record<Language, string>> = {
  [Language.TypeScript]: typescriptQueries,
  [Language.JavaScript]: javascriptQueries,
  [Language.Python]:     pythonQueries,
  [Language.Java]:       javaQueries,
  [Language.Go]:         goQueries,
  [Language.C]:          cQueries,
  [Language.Cpp]:        cppQueries,
  [Language.CSharp]:     csharpQueries,
  [Language.Rust]:       rustQueries,
  [Language.PHP]:        phpQueries,
  [Language.Ruby]:       rubyQueries,
};

// ── Tree-sitter extraction ────────────────────────────────────────────────────

function isNodeExported(defNode: import('web-tree-sitter').Node, lang: Language, name: string): boolean {
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    let cur: import('web-tree-sitter').Node | null = defNode.parent;
    while (cur) {
      if (cur.type === 'export_statement') return true;
      cur = cur.parent;
    }
    return false;
  }
  if (lang === Language.Go) {
    return name.length > 0 && /[A-Z]/.test(name[0]!);
  }
  if (lang === Language.Rust) {
    let cur: import('web-tree-sitter').Node | null = defNode.parent;
    while (cur) {
      if (cur.type === 'visibility_modifier') return true;
      if (cur.type === 'source_file') break;
      cur = cur.parent;
    }
    return false;
  }
  if (lang === Language.Python) {
    return !name.startsWith('_');
  }
  if (lang === Language.Java || lang === Language.CSharp) {
    let cur: import('web-tree-sitter').Node | null = defNode.parent;
    while (cur) {
      if (cur.type === 'modifiers') return cur.text.includes('public');
      if (cur.type.includes('declaration')) return cur.text.trimStart().startsWith('public');
      cur = cur.parent;
    }
    return false;
  }
  return true;
}

async function extractWithTreeSitter(
  source: string,
  lang: Language,
): Promise<ExtractedSymbol[] | null> {
  const queryStr = LANG_QUERIES[lang];
  if (!queryStr) return null;

  const [tree, tsLang] = await Promise.all([
    parseSource(lang, source),
    getLanguage(lang),
  ]);
  if (!tree || !tsLang) return null;

  const matches = runQueryMatches(tree, tsLang, queryStr);
  const results: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    const defCapture = m.captures.find(
      (c) => c.name.startsWith('def.') && !c.name.endsWith('.name'),
    );
    const nameCapture = m.captures.find((c) => c.name.endsWith('.name'));
    if (!defCapture || !nameCapture) continue;

    const kind = captureKind(defCapture.name);
    if (!kind) continue;

    const name = nameCapture.text.trim();
    if (!name) continue;

    const key = `${kind}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const n = defCapture.node;
    results.push({
      kind,
      name,
      exported: isNodeExported(defCapture.node, lang, name),
      startLine: n.startPosition.row + 1,
      endLine:   n.endPosition.row + 1,
    });
  }

  return results.length > 0 ? results : null;
}

// ── Regex fallback (matches parse-phase.ts original logic) ───────────────────

function extractWithRegex(source: string, lang: Language): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('*') || line.startsWith('/*')) continue;

    let sym: { kind: string; name: string; exported: boolean } | null = null;

    if (lang === Language.TypeScript || lang === Language.JavaScript) {
      const func = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
      if (func) sym = { kind: 'function', name: func[1]!, exported: line.includes('export') };
      if (!sym) { const a = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/); if (a) sym = { kind: 'function', name: a[1]!, exported: line.includes('export') }; }
      if (!sym) { const b = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/); if (b) sym = { kind: 'function', name: b[1]!, exported: line.includes('export') }; }
      if (!sym) { const c = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/); if (c) sym = { kind: 'class', name: c[1]!, exported: line.includes('export') }; }
      if (!sym) { const d = line.match(/^(?:export\s+)?interface\s+(\w+)/); if (d) sym = { kind: 'interface', name: d[1]!, exported: line.includes('export') }; }
      if (!sym) { const e = line.match(/^(?:export\s+)?enum\s+(\w+)/); if (e) sym = { kind: 'enum', name: e[1]!, exported: line.includes('export') }; }
      if (!sym) { const f = line.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/); if (f) sym = { kind: 'type_alias', name: f[1]!, exported: line.includes('export') }; }
      if (!sym) { const g = line.match(/^\s*(?:async\s+)?(\w+)\s*\(/); if (g && !['if','for','while','switch','return','new','constructor','catch'].includes(g[1]!)) sym = { kind: 'method', name: g[1]!, exported: !line.includes('private') }; }
      if (!sym) { const h = line.match(/^\s*constructor\s*\(/); if (h) sym = { kind: 'method', name: 'constructor', exported: true }; }
    }

    if (lang === Language.Python) {
      const func = line.match(/^(?:async\s+)?def\s+(\w+)/);
      if (func) sym = { kind: 'function', name: func[1]!, exported: !func[1]!.startsWith('_') };
      if (!sym) { const cls = line.match(/^class\s+(\w+)/); if (cls) sym = { kind: 'class', name: cls[1]!, exported: !cls[1]!.startsWith('_') }; }
    }

    if (lang === Language.Go) {
      const func = line.match(/^func\s+(\w+)\s*\(/); if (func) sym = { kind: 'function', name: func[1]!, exported: func[1]![0] === func[1]![0]!.toUpperCase() };
      if (!sym) { const m2 = line.match(/^func\s+\([^)]+\)\s+(\w+)\s*\(/); if (m2) sym = { kind: 'method', name: m2[1]!, exported: m2[1]![0] === m2[1]![0]!.toUpperCase() }; }
      if (!sym) { const s = line.match(/^type\s+(\w+)\s+struct\b/); if (s) sym = { kind: 'struct', name: s[1]!, exported: s[1]![0] === s[1]![0]!.toUpperCase() }; }
      if (!sym) { const ifc = line.match(/^type\s+(\w+)\s+interface\b/); if (ifc) sym = { kind: 'interface', name: ifc[1]!, exported: ifc[1]![0] === ifc[1]![0]!.toUpperCase() }; }
    }

    if (lang === Language.Rust) {
      const fn_ = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/); if (fn_) sym = { kind: 'function', name: fn_[1]!, exported: line.startsWith('pub') };
      if (!sym) { const s = line.match(/^(?:pub\s+)?struct\s+(\w+)/); if (s) sym = { kind: 'struct', name: s[1]!, exported: line.startsWith('pub') }; }
      if (!sym) { const e = line.match(/^(?:pub\s+)?enum\s+(\w+)/); if (e) sym = { kind: 'enum', name: e[1]!, exported: line.startsWith('pub') }; }
      if (!sym) { const t = line.match(/^(?:pub\s+)?trait\s+(\w+)/); if (t) sym = { kind: 'trait', name: t[1]!, exported: line.startsWith('pub') }; }
    }

    if (lang === Language.Java) {
      const cls = line.match(/(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/); if (cls) sym = { kind: 'class', name: cls[1]!, exported: line.includes('public') };
      if (!sym) { const ifc = line.match(/(?:public\s+)?interface\s+(\w+)/); if (ifc) sym = { kind: 'interface', name: ifc[1]!, exported: line.includes('public') }; }
      if (!sym) { const en = line.match(/(?:public\s+)?enum\s+(\w+)/); if (en) sym = { kind: 'enum', name: en[1]!, exported: line.includes('public') }; }
      if (!sym) { const m2 = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(/); if (m2) sym = { kind: 'method', name: m2[1]!, exported: line.includes('public') }; }
    }

    if (lang === Language.Ruby) {
      const cls = line.match(/^class\s+(\w+)/); if (cls) sym = { kind: 'class', name: cls[1]!, exported: true };
      if (!sym) { const mod = line.match(/^module\s+(\w+)/); if (mod) sym = { kind: 'module', name: mod[1]!, exported: true }; }
      if (!sym) { const m2 = line.match(/^def\s+(?:self\.)?(\w+)/); if (m2) sym = { kind: 'method', name: m2[1]!, exported: true }; }
    }

    if (lang === Language.PHP) {
      const cls = line.match(/(?:abstract\s+)?class\s+(\w+)/); if (cls) sym = { kind: 'class', name: cls[1]!, exported: true };
      if (!sym) { const ifc = line.match(/interface\s+(\w+)/); if (ifc) sym = { kind: 'interface', name: ifc[1]!, exported: true }; }
      if (!sym) { const tr = line.match(/trait\s+(\w+)/); if (tr) sym = { kind: 'trait', name: tr[1]!, exported: true }; }
      if (!sym) { const fn_ = line.match(/function\s+(\w+)/); if (fn_) sym = { kind: 'function', name: fn_[1]!, exported: !line.includes('private') }; }
    }

    if (lang === Language.CSharp) {
      const cls = line.match(/(?:public\s+)?(?:abstract\s+)?(?:partial\s+)?class\s+(\w+)/); if (cls) sym = { kind: 'class', name: cls[1]!, exported: line.includes('public') };
      if (!sym) { const ifc = line.match(/(?:public\s+)?interface\s+(\w+)/); if (ifc) sym = { kind: 'interface', name: ifc[1]!, exported: line.includes('public') }; }
      if (!sym) { const en = line.match(/(?:public\s+)?enum\s+(\w+)/); if (en) sym = { kind: 'enum', name: en[1]!, exported: line.includes('public') }; }
      if (!sym) { const st = line.match(/(?:public\s+)?struct\s+(\w+)/); if (st) sym = { kind: 'struct', name: st[1]!, exported: line.includes('public') }; }
      if (!sym) { const m2 = line.match(/(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(/); if (m2) sym = { kind: 'method', name: m2[1]!, exported: line.includes('public') }; }
    }

    if (lang === Language.C || lang === Language.Cpp) {
      const cls = line.match(/^(?:class|struct)\s+(\w+)/); if (cls) sym = { kind: lang === Language.Cpp ? 'class' : 'struct', name: cls[1]!, exported: true };
      if (!sym) { const fn_ = line.match(/^(?:[\w:*&<>\[\]]+\s+)+(\w+)\s*\([^;]*$/); if (fn_ && !['if','for','while','switch','return'].includes(fn_[1]!)) sym = { kind: 'function', name: fn_[1]!, exported: true }; }
    }

    if (sym) {
      const key = `${sym.kind}:${sym.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ ...sym, startLine: i + 1, endLine: i + 1 });
      }
    }
  }

  return results;
}

// ── Combined extractor: tree-sitter first, regex fallback ─────────────────────

async function extractSymbols(
  source: string,
  lang: Language,
): Promise<{ symbols: ExtractedSymbol[]; parser: 'tree-sitter' | 'regex' }> {
  const tsResult = await extractWithTreeSitter(source, lang);
  if (tsResult) return { symbols: tsResult, parser: 'tree-sitter' };
  return { symbols: extractWithRegex(source, lang), parser: 'regex' };
}

// ── Load all golden files ─────────────────────────────────────────────────────

function loadGoldenFiles(): GoldenFile[] {
  const goldenFiles: GoldenFile[] = [];
  if (!fs.existsSync(GOLDEN_DIR)) return goldenFiles;
  const files = fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.golden.json'));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf-8');
    goldenFiles.push(JSON.parse(raw) as GoldenFile);
  }
  return goldenFiles;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const goldenFiles = loadGoldenFiles();

describe('Parser Corpus — infrastructure', () => {
  it('golden files directory exists', () => {
    assert.ok(fs.existsSync(GOLDEN_DIR), `Golden files directory not found: ${GOLDEN_DIR}`);
  });

  it('fixtures directory exists', () => {
    assert.ok(fs.existsSync(FIXTURES_DIR), `Fixtures directory not found: ${FIXTURES_DIR}`);
  });

  it('at least one golden file exists', () => {
    assert.ok(goldenFiles.length > 0, 'No golden files found in parser-corpus/golden/');
  });
});

for (const golden of goldenFiles) {
  describe(`Parser corpus — ${golden.language} (${golden.fixture})`, () => {
    let extractedSymbols: ExtractedSymbol[] = [];
    let parserUsed: 'tree-sitter' | 'regex' = 'regex';

    before(async () => {
      const fixturePath = path.join(FIXTURES_DIR, golden.fixture);
      assert.ok(fs.existsSync(fixturePath), `Fixture file not found: ${fixturePath}`);
      const source = fs.readFileSync(fixturePath, 'utf-8');
      const ext = path.extname(golden.fixture);
      const lang = EXT_TO_LANG[ext];
      assert.ok(lang !== undefined, `No language mapping for extension ${ext}`);
      const result = await extractSymbols(source, lang!);
      extractedSymbols = result.symbols;
      parserUsed = result.parser;
    });

    it('extraction produces at least one symbol', () => {
      assert.ok(
        extractedSymbols.length > 0,
        `No symbols extracted from ${golden.fixture} — parser may be broken`,
      );
    });

    it(`shows which parser was used (tree-sitter preferred)`, () => {
      // This test always passes; it's informational
      assert.ok(['tree-sitter', 'regex'].includes(parserUsed));
    });

    for (const expected of golden.expectedSymbols) {
      it(`extracts expected symbol: ${expected.kind} "${expected.name}"`, () => {
        const found = extractedSymbols.find(
          (s) =>
            s.name === expected.name &&
            (s.kind === expected.kind ||
              (expected.kind === 'function' && (s.kind === 'method' || s.kind === 'function')) ||
              (expected.kind === 'method' && (s.kind === 'function' || s.kind === 'method'))),
        );
        assert.ok(
          found !== undefined,
          [
            `RECALL FAILURE: ${expected.kind} "${expected.name}" not extracted from ${golden.fixture} (parser: ${parserUsed}).`,
            `  Extracted: ${extractedSymbols.map((s) => `${s.kind}:${s.name}`).join(', ')}`,
          ].join('\n'),
        );
      });
    }

    if (golden.prohibitedSymbols && golden.prohibitedSymbols.length > 0) {
      for (const prohibName of golden.prohibitedSymbols) {
        it(`does NOT extract prohibited symbol "${prohibName}" as exported`, () => {
          const found = extractedSymbols.find((s) => s.name === prohibName && s.exported);
          assert.ok(
            found === undefined,
            `Prohibited exported symbol "${prohibName}" found in ${golden.fixture} (kind=${found?.kind}, parser=${parserUsed}).`,
          );
        });
      }
    }

    it(`recall: all ${golden.expectedSymbols.length} expected symbols found`, () => {
      const missing: string[] = [];
      for (const exp of golden.expectedSymbols) {
        const found = extractedSymbols.find(
          (s) =>
            s.name === exp.name &&
            (s.kind === exp.kind ||
              (exp.kind === 'function' && (s.kind === 'method' || s.kind === 'function')) ||
              (exp.kind === 'method' && (s.kind === 'function' || s.kind === 'method'))),
        );
        if (!found) missing.push(`${exp.kind}:${exp.name}`);
      }
      assert.equal(
        missing.length,
        0,
        [
          `RECALL REGRESSION in ${golden.fixture} (parser: ${parserUsed}): ${missing.length}/${golden.expectedSymbols.length} missing:`,
          `  ${missing.join(', ')}`,
          `  Extracted: ${extractedSymbols.map((s) => `${s.kind}:${s.name}`).join(', ')}`,
        ].join('\n'),
      );
    });
  });
}
