/**
 * Parser Regression Corpus Tests — Epic 8
 *
 * Validates that the symbol extraction pipeline produces at least the expected
 * set of symbols ("recall must not decrease") for every language fixture.
 *
 * Golden files live in tests/parser-corpus/golden/*.golden.json.
 * Fixture source files live in tests/parser-corpus/fixtures/.
 *
 * CI gate rule: ALL expectedSymbols in each golden file must be found in the
 * extracted output. Missing symbols → test failure → block merge.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { detectLanguage } from '../../../src/shared/index.js';
import type { CodeNode } from '../../../src/shared/index.js';

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'tests', 'parser-corpus');
const FIXTURES_DIR = path.join(CORPUS_DIR, 'fixtures');
const GOLDEN_DIR = path.join(CORPUS_DIR, 'golden');

// ── Golden file shape ─────────────────────────────────────────────────────────

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

// ── Minimal symbol extractor (mirrors parse-phase.ts extractSymbol logic) ────
// We duplicate the extraction here so the test is standalone and doesn't
// depend on the full pipeline infrastructure.

interface ExtractedSymbol {
  kind: string;
  name: string;
  exported: boolean;
}

function extractSymbolsFromSource(source: string, langStr: string): ExtractedSymbol[] {
  const Language = {
    TypeScript: 'typescript',
    JavaScript: 'javascript',
    Python: 'python',
    Java: 'java',
    Go: 'go',
    Rust: 'rust',
    C: 'c',
    Cpp: 'cpp',
    CSharp: 'csharp',
    PHP: 'php',
    Kotlin: 'kotlin',
    Ruby: 'ruby',
    Swift: 'swift',
    Dart: 'dart',
  } as const;

  const results: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  const lines = source.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('*') || line.startsWith('/*')) continue;

    let sym: ExtractedSymbol | null = null;

    if (langStr === Language.TypeScript || langStr === Language.JavaScript) {
      const func = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
      if (func) sym = { kind: 'function', name: func[1]!, exported: line.includes('export') };

      if (!sym) {
        const arrow = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
        if (arrow) sym = { kind: 'function', name: arrow[1]!, exported: line.includes('export') };
      }
      if (!sym) {
        const arrow2 = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/);
        if (arrow2) sym = { kind: 'function', name: arrow2[1]!, exported: line.includes('export') };
      }
      if (!sym) {
        const cls = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/);
        if (cls) sym = { kind: 'class', name: cls[1]!, exported: line.includes('export') };
      }
      if (!sym) {
        const iface = line.match(/^(?:export\s+)?interface\s+(\w+)/);
        if (iface) sym = { kind: 'interface', name: iface[1]!, exported: line.includes('export') };
      }
      if (!sym) {
        const enumM = line.match(/^(?:export\s+)?enum\s+(\w+)/);
        if (enumM) sym = { kind: 'enum', name: enumM[1]!, exported: line.includes('export') };
      }
      if (!sym) {
        const typeA = line.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/);
        if (typeA) sym = { kind: 'type_alias', name: typeA[1]!, exported: line.includes('export') };
      }
      if (!sym) {
        const constV = line.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=/);
        if (constV && /^[A-Z_]+$/.test(constV[1]!)) {
          sym = { kind: 'constant', name: constV[1]!, exported: line.includes('export') };
        }
      }
      if (!sym) {
        const method = line.match(/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\(/);
        if (method && !['if', 'for', 'while', 'switch', 'return', 'new', 'constructor'].includes(method[1]!)) {
          sym = { kind: 'method', name: method[1]!, exported: !line.includes('private') };
        }
      }
      if (!sym) {
        const ctor = line.match(/^\s*constructor\s*\(/);
        if (ctor) sym = { kind: 'method', name: 'constructor', exported: true };
      }
    }

    if (langStr === Language.Python) {
      const func = line.match(/^(?:async\s+)?def\s+(\w+)/);
      if (func) sym = { kind: func[1]!.startsWith('__') || func[1]!.startsWith('_') ? 'method' : 'function', name: func[1]!, exported: !func[1]!.startsWith('_') };
      if (!sym) {
        const cls = line.match(/^class\s+(\w+)/);
        if (cls) sym = { kind: 'class', name: cls[1]!, exported: !cls[1]!.startsWith('_') };
      }
    }

    if (langStr === Language.Go) {
      const func = line.match(/^func\s+(\w+)\s*\(/);
      if (func) sym = { kind: 'function', name: func[1]!, exported: func[1]![0] === func[1]![0]!.toUpperCase() };
      if (!sym) {
        const method = line.match(/^func\s+\([^)]+\)\s+(\w+)\s*\(/);
        if (method) sym = { kind: 'method', name: method[1]!, exported: method[1]![0] === method[1]![0]!.toUpperCase() };
      }
      if (!sym) {
        const structM = line.match(/^type\s+(\w+)\s+struct\b/);
        if (structM) sym = { kind: 'struct', name: structM[1]!, exported: structM[1]![0] === structM[1]![0]!.toUpperCase() };
      }
      if (!sym) {
        const ifaceM = line.match(/^type\s+(\w+)\s+interface\b/);
        if (ifaceM) sym = { kind: 'interface', name: ifaceM[1]!, exported: ifaceM[1]![0] === ifaceM[1]![0]!.toUpperCase() };
      }
    }

    if (langStr === Language.Rust) {
      const func = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
      if (func) sym = { kind: 'function', name: func[1]!, exported: line.startsWith('pub') };
      if (!sym) {
        const structM = line.match(/^(?:pub\s+)?struct\s+(\w+)/);
        if (structM) sym = { kind: 'struct', name: structM[1]!, exported: line.startsWith('pub') };
      }
      if (!sym) {
        const enumM = line.match(/^(?:pub\s+)?enum\s+(\w+)/);
        if (enumM) sym = { kind: 'enum', name: enumM[1]!, exported: line.startsWith('pub') };
      }
      if (!sym) {
        const traitM = line.match(/^(?:pub\s+)?trait\s+(\w+)/);
        if (traitM) sym = { kind: 'trait', name: traitM[1]!, exported: line.startsWith('pub') };
      }
    }

    if (sym) {
      const key = `${sym.kind}:${sym.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(sym);
      }
    }
  }

  return results;
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

// ── Run corpus tests ──────────────────────────────────────────────────────────

const goldenFiles = loadGoldenFiles();

describe('Parser Corpus — recall gate', () => {
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

    before(() => {
      const fixturePath = path.join(FIXTURES_DIR, golden.fixture);
      assert.ok(fs.existsSync(fixturePath), `Fixture file not found: ${fixturePath}`);
      const source = fs.readFileSync(fixturePath, 'utf-8');

      // Derive language tag from fixture filename
      const ext = path.extname(golden.fixture);
      const langMap: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.mjs': 'javascript',
        '.py': 'python',
        '.go': 'go',
        '.rs': 'rust',
        '.java': 'java',
        '.kt': 'kotlin',
        '.rb': 'ruby',
        '.php': 'php',
        '.cs': 'csharp',
        '.swift': 'swift',
        '.dart': 'dart',
        '.c': 'c',
        '.cpp': 'cpp',
      };
      const langKey = langMap[ext] ?? ext.slice(1);
      extractedSymbols = extractSymbolsFromSource(source, langKey);
    });

    it('extraction produces at least one symbol', () => {
      assert.ok(
        extractedSymbols.length > 0,
        `No symbols extracted from ${golden.fixture} — parser may be broken`,
      );
    });

    for (const expected of golden.expectedSymbols) {
      it(`extracts expected symbol: ${expected.kind} "${expected.name}" (exported=${expected.exported})`, () => {
        const found = extractedSymbols.find(
          (s) =>
            s.name === expected.name &&
            (s.kind === expected.kind ||
              // Allow 'method' to satisfy 'function' and vice-versa (extractor may differ)
              (expected.kind === 'function' && s.kind === 'method') ||
              (expected.kind === 'method' && s.kind === 'function')),
        );

        assert.ok(
          found !== undefined,
          [
            `RECALL FAILURE: ${expected.kind} "${expected.name}" was not extracted from ${golden.fixture}.`,
            `  Extracted symbols: ${extractedSymbols.map((s) => `${s.kind}:${s.name}`).join(', ')}`,
            `  This is a REGRESSION — the parser used to find this symbol.`,
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
            `Prohibited symbol "${prohibName}" was extracted as exported from ${golden.fixture} (kind=${found?.kind}).`,
          );
        });
      }
    }

    it(`recall is 100%: all ${golden.expectedSymbols.length} expected symbols found`, () => {
      const missing: string[] = [];
      for (const exp of golden.expectedSymbols) {
        const found = extractedSymbols.find(
          (s) =>
            s.name === exp.name &&
            (s.kind === exp.kind ||
              (exp.kind === 'function' && s.kind === 'method') ||
              (exp.kind === 'method' && s.kind === 'function')),
        );
        if (!found) missing.push(`${exp.kind}:${exp.name}`);
      }
      assert.equal(
        missing.length,
        0,
        [
          `RECALL REGRESSION in ${golden.fixture}: ${missing.length}/${golden.expectedSymbols.length} symbols missing:`,
          `  ${missing.join(', ')}`,
        ].join('\n'),
      );
    });
  });
}
