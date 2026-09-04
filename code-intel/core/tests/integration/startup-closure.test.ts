/**
 * Verifies the query-only MCP/HTTP startup boundary: heavy program-analysis
 * modules (tree-sitter grammars, lowering adapters, dataflow/PDG/taint
 * engines) must be reachable only through a dynamic `import()`, never
 * through a static `import`/`export ... from` chain starting at the
 * server entrypoints — otherwise every MCP/HTTP process pays their load
 * cost on startup regardless of whether program-analysis is ever used.
 *
 * This walks the *compiled* `.js` output (not the `.ts` sources) so
 * type-only imports — already erased by tsc — can't produce a false
 * positive, and so the check reflects what Node actually loads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIST_SRC_ROOT = path.resolve(import.meta.dirname, '../../src');

// Matches a static `import ... from '...'` / `export ... from '...'` specifier.
// Deliberately does NOT match `import('...')` dynamic calls — those are the
// escape hatch this test exists to protect, not something to flag.
const STATIC_IMPORT_RE = /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // bare package import — outside our own closure
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function collectStaticClosure(entryFile: string): Set<string> {
  const visited = new Set<string>();
  const stack = [entryFile];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    let contents: string;
    try {
      contents = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of contents.matchAll(STATIC_IMPORT_RE)) {
      const resolved = resolveSpecifier(file, match[1]!);
      if (resolved && !visited.has(resolved)) stack.push(resolved);
    }
  }
  return visited;
}

function assertNoProgramAnalysisInClosure(entryRelativePath: string): void {
  const entryFile = path.join(DIST_SRC_ROOT, entryRelativePath);
  assert.ok(fs.existsSync(entryFile), `entry file not found: ${entryFile} (run: tsc -b tsconfig.test.json)`);
  const closure = collectStaticClosure(entryFile);
  const offenders = [...closure].filter((f) => f.includes(`${path.sep}program-analysis${path.sep}`)).sort();
  assert.deepEqual(
    offenders,
    [],
    `program-analysis modules must be reached only via dynamic import(), not statically from ${entryRelativePath}:\n${offenders.join('\n')}`,
  );
}

describe('query-only startup closure excludes program-analysis', () => {
  it('mcp-server/server.js does not statically import any program-analysis module', () => {
    assertNoProgramAnalysisInClosure('mcp-server/server.js');
  });

  it('http/app.js does not statically import any program-analysis module', () => {
    assertNoProgramAnalysisInClosure('http/app.js');
  });

  it('cli/app.js reaches program-analysis only through the inspect command\'s dynamic import', () => {
    assertNoProgramAnalysisInClosure('cli/app.js');
  });
});

describe('startup closure detector (self-test on a synthetic fixture)', () => {
  it('flags a synthetic static import chain that reaches a program-analysis-named module', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-closure-selftest-'));
    try {
      fs.mkdirSync(path.join(dir, 'program-analysis'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'program-analysis', 'heavy.js'), 'export const heavy = true;\n');
      fs.writeFileSync(path.join(dir, 'mid.js'), "export { heavy } from './program-analysis/heavy.js';\n");
      fs.writeFileSync(path.join(dir, 'entry.js'), "import { heavy } from './mid.js';\nexport { heavy };\n");

      const closure = collectStaticClosure(path.join(dir, 'entry.js'));
      const offenders = [...closure].filter((f) => f.includes(`${path.sep}program-analysis${path.sep}`));
      assert.equal(offenders.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag a synthetic dynamic import() reaching a program-analysis-named module', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-closure-selftest-'));
    try {
      fs.mkdirSync(path.join(dir, 'program-analysis'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'program-analysis', 'heavy.js'), 'export const heavy = true;\n');
      fs.writeFileSync(path.join(dir, 'entry.js'), "export async function load() { return import('./program-analysis/heavy.js'); }\n");

      const closure = collectStaticClosure(path.join(dir, 'entry.js'));
      const offenders = [...closure].filter((f) => f.includes(`${path.sep}program-analysis${path.sep}`));
      assert.equal(offenders.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
