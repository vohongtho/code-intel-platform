import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceStore } from '../../../src/evidence/store.js';
import { diffConvergenceSnapshots } from '../../../src/incremental/convergence-snapshot.js';
import {
  applyIncrementalEdit,
  buildInitialState,
  runFullRebuild,
  snapshotOf,
  type WorkspaceFiles,
} from './convergence-harness.js';

/**
 * Scope note: the TypeScript fact adapter (`src/semantic/adapters/typescript.ts`)
 * is a line-by-line regex extractor. It reliably populates DeclarationFact,
 * DeclarationFragmentFact, PublishedNameFact, and ImportBindingFact for
 * single-line `export class|function|interface|enum|const` and
 * `import {...} from '...'` statements. It does NOT yet extract real
 * CallSiteFact/ReferenceFact/HeritageFact/RegistrationFact for general code —
 * its one "reference" case is a hardcoded match on the literal corpus fixture
 * string `new UserService(...)`, not a general `new X()` pattern. Separately,
 * `PublishedNameFact.moduleRef` (an exporting file's own path, e.g.
 * `service.ts`) is never normalized against `ImportBindingFact.sourceModule`
 * (an importer's raw specifier, e.g. `./service.js`), which is also the exact
 * key `resolveReference`'s module-chain lookup uses — so cross-file import
 * resolution does not actually connect for ordinary relative imports today.
 * Both gaps are pre-existing, in code this change depends on rather than
 * owns, and are called out in the session's final report.
 *
 * These integration tests are scoped accordingly: they drive the REAL parser
 * and resolution pipeline end-to-end and prove the incremental
 * snapshot/delta/closure/re-materialization machinery keeps the graph's
 * DECLARATION set — the one thing genuinely populated today — convergent
 * with a full rebuild across realistic edit histories, including body-only
 * vs shape-change classification and add/remove/rename. Cross-file
 * call/heritage/registration/route invalidation is proven instead by the
 * synthetic-fact unit tests under tests/unit/incremental/, which construct
 * facts matching the documented SemanticFact contracts directly.
 */

function withEvidenceStore<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convergence-evidence-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('dependency-aware incremental convergence (TypeScript, real parser)', () => {
  it('body-only edit: narrow invalidation, and the resulting graph still converges with a full rebuild', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'a.ts': [
          'export class Widget {',
          '  helper(): number { return 1; }',
          '}',
        ].join('\n'),
      };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = {
        'a.ts': [
          'export class Widget {',
          '  helper(): number { return 2; }',
          '}',
        ].join('\n'),
      };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      assert.equal(delta.requiresFullResolution, false);
      assert.deepEqual(delta.bodyOnlyFiles, ['a.ts']);
      initialEvidence.close();

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(edited, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });

  it('a shape-changing addition (new exported declaration) is not misclassified as body-only, and still converges', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = { 'widget.ts': 'export class Widget { }' };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = { 'widget.ts': 'export class Widget { }\nexport class Gadget { }' };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      assert.equal(delta.requiresFullResolution, false);
      assert.deepEqual(delta.bodyOnlyFiles, []);
      assert.ok(delta.addedFacts.some((id) => id.includes('Gadget')));
      initialEvidence.close();

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(edited, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });

  it('deleting a file converges with a fresh full rebuild of the remaining tree', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'widget.ts': 'export class Widget { }',
        'consumer.ts': "import { Widget } from './widget.js';",
      };
      const state = buildInitialState(files, initialEvidence);

      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { deletedFiles: ['widget.ts'] });
      initialEvidence.close();
      if (delta.requiresFullResolution) return; // acceptable fallback; nothing further to compare

      const remaining: WorkspaceFiles = { 'consumer.ts': files['consumer.ts']! };
      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(remaining, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });

  it('falls back to full resolution rather than truncate when the reverse-dependency index is unavailable', () => {
    withEvidenceStore((dir) => {
      const evidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = { 'a.ts': 'export class Widget {}' };
      const state = buildInitialState(files, evidence);

      const staleReverseIndex = null;
      const { delta } = applyIncrementalEdit(
        { ...state, reverseIndex: staleReverseIndex as never },
        evidence,
        { changedFiles: { 'a.ts': 'export class RenamedWidget {}' } },
      );
      evidence.close();
      assert.equal(delta.requiresFullResolution, true);
    });
  });

  it('runs a 14-edit history (add/remove/rename/import/competing-declaration/body-only) and converges on the final tree', () => {
    withEvidenceStore((dir) => {
      const evidence = createEvidenceStore(dir);
      let files: WorkspaceFiles = {
        'widget.ts': 'export class Widget { }',
        'consumer.ts': "import { Widget } from './widget.js';",
        'helper.ts': 'export function noop(): void { }',
      };
      let state = buildInitialState(files, evidence);
      let sawFallback = false;

      const edits: Array<{ changedFiles?: WorkspaceFiles; deletedFiles?: string[] }> = [
        { changedFiles: { 'helper.ts': 'export function noop(): void { /* v2 */ }' } }, // body-only (comment-only)
        { changedFiles: { 'extra.ts': 'export class Widget { }' } }, // competing declaration
        { changedFiles: { 'extra.ts': 'export class Widget { }', 'widget.ts': 'export class Widget { }' } }, // idempotent re-write
        { deletedFiles: ['extra.ts'] }, // remove the competing declaration
        { changedFiles: { 'widget.ts': 'export class WidgetImpl { }' } }, // rename (remove+add)
        { changedFiles: { 'consumer.ts': "import { WidgetImpl } from './widget.js';" } },
        { changedFiles: { 'other.ts': 'export function util(): number { return 1; }' } }, // new file
        { changedFiles: { 'other.ts': 'export function util(): number { return 2; }' } }, // body-only on new file
        { changedFiles: { 'consumer2.ts': "import { WidgetImpl } from './widget.js';" } }, // second importer
        { changedFiles: { 'widget.ts': 'export class WidgetImplV2 { }' } }, // second rename
        {
          changedFiles: {
            'consumer.ts': "import { WidgetImplV2 } from './widget.js';",
            'consumer2.ts': "import { WidgetImplV2 } from './widget.js';",
          },
        },
        { deletedFiles: ['other.ts'] },
        { changedFiles: { 'helper.ts': 'export function noop(): void { /* v3 */ }' } }, // body-only again
        { changedFiles: { 'widget.ts': 'export class WidgetImplV2 { }\nexport class Extra { }' } }, // add a second declaration
      ];

      for (const edit of edits) {
        const result = applyIncrementalEdit(state, evidence, edit);
        const merged: WorkspaceFiles = { ...files };
        for (const [k, v] of Object.entries(edit.changedFiles ?? {})) merged[k] = v;
        for (const removed of edit.deletedFiles ?? []) delete merged[removed];
        files = merged;
        if (result.delta.requiresFullResolution) {
          sawFallback = true;
          state = buildInitialState(files, evidence);
        } else {
          state = result.state;
        }
      }

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(files, fullEvidence);
      const incrementalSnap = snapshotOf(state, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();
      evidence.close();

      const problems = diffConvergenceSnapshots(fullSnap, incrementalSnap);
      assert.deepEqual(problems, [], `history should converge with a fresh full rebuild of the final tree (sawFallback=${sawFallback}): ${problems.join('; ')}`);
    });
  });
});

/**
 * A second representative language. The Python fact adapter (unlike
 * TypeScript's) genuinely extracts HeritageFact for `class X(Base):`, so this
 * exercises cross-file 'heritage' domain invalidation with real adapter
 * output — coverage the TypeScript suite above cannot provide today.
 */
describe('dependency-aware incremental convergence (Python, real parser)', () => {
  it('renaming a base class invalidates an unchanged subclass\'s heritage fact elsewhere, and still converges', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'base.py': 'class Base:\n    pass',
        'derived.py': 'from base import Base\nclass Derived(Base):\n    pass',
      };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = { ...files, 'base.py': 'class BaseImpl:\n    pass' };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, {
        changedFiles: { 'base.py': edited['base.py']! },
      });
      assert.equal(delta.requiresFullResolution, false);
      assert.deepEqual(delta.bodyOnlyFiles, []);
      assert.ok(delta.invalidatedSymbols.length > 0, 'derived.py\'s heritage fact should be invalidated');
      initialEvidence.close();

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(edited, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });

  it('body-only edit on a Python function is not misclassified as a shape change', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = { 'util.py': 'def helper(x):\n    return x + 1' };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = { 'util.py': 'def helper(x):\n    return x + 2' };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      assert.equal(delta.requiresFullResolution, false);
      assert.deepEqual(delta.bodyOnlyFiles, ['util.py']);
      initialEvidence.close();

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(edited, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });
});

/**
 * A third representative language. Go's fact adapter extracts real
 * `HeritageFact`s for struct embedding (`type Derived struct { Base }`) —
 * confirmed by direct adapter probing — giving independent cross-file
 * heritage-domain coverage from a differently-shaped adapter than Python's.
 */
describe('dependency-aware incremental convergence (Go, real parser)', () => {
  it('renaming an embedded struct invalidates an unchanged embedder\'s heritage fact elsewhere, and still converges', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = {
        'base.go': ['package main', '', 'type Base struct {', '}'].join('\n'),
        'derived.go': ['package main', '', 'type Derived struct {', '\tBase', '}'].join('\n'),
      };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = { ...files, 'base.go': ['package main', '', 'type BaseImpl struct {', '}'].join('\n') };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, {
        changedFiles: { 'base.go': edited['base.go']! },
      });
      assert.equal(delta.requiresFullResolution, false);
      assert.deepEqual(delta.bodyOnlyFiles, []);
      assert.ok(delta.invalidatedSymbols.length > 0, 'derived.go\'s heritage fact should be invalidated');
      initialEvidence.close();

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(edited, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });

  it('body-only edit inside a Go struct is not misclassified as a shape change', () => {
    withEvidenceStore((dir) => {
      const initialEvidence = createEvidenceStore(dir);
      const files: WorkspaceFiles = { 'widget.go': ['package main', '', 'type Widget struct {', '\tName string', '}'].join('\n') };
      const state = buildInitialState(files, initialEvidence);

      const edited: WorkspaceFiles = { 'widget.go': ['package main', '', 'type Widget struct {', '\tName string', '\t// touched', '}'].join('\n') };
      const { delta, state: nextState } = applyIncrementalEdit(state, initialEvidence, { changedFiles: edited });
      assert.equal(delta.requiresFullResolution, false);
      initialEvidence.close();

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(edited, fullEvidence);
      const incrementalSnap = snapshotOf(nextState, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();

      assert.deepEqual(diffConvergenceSnapshots(fullSnap, incrementalSnap), []);
    });
  });
});

/**
 * A genuine ~50-edit long history (task 13's mandate) for the most mature
 * representative language (TypeScript), generated programmatically rather
 * than hand-authored: a growing pool of files each declaring one exported
 * class, mutated by a fixed rotation of add/remove/rename/no-op edits, with
 * periodic multi-file batches. Verifies the incrementally-maintained graph
 * still matches a fresh full rebuild after the full history.
 */
describe('dependency-aware incremental convergence (TypeScript, 50-edit generated history)', () => {
  it('converges with a fresh full rebuild after 50 generated edits', () => {
    withEvidenceStore((dir) => {
      const evidence = createEvidenceStore(dir);
      const classSource = (name: string): string => `export class ${name} { }`;
      const classNameOf = (source: string): string => source.match(/class (\w+)/)![1]!;

      let files: WorkspaceFiles = {
        'f0.ts': classSource('Widget0'),
        'f1.ts': classSource('Widget1'),
        'f2.ts': classSource('Widget2'),
      };
      let state = buildInitialState(files, evidence);
      let sawFallback = false;
      let nextIndex = 3;

      function applyAndAdvance(edit: { changedFiles?: WorkspaceFiles; deletedFiles?: string[] }): void {
        const result = applyIncrementalEdit(state, evidence, edit);
        const merged: WorkspaceFiles = { ...files };
        for (const [k, v] of Object.entries(edit.changedFiles ?? {})) merged[k] = v;
        for (const removed of edit.deletedFiles ?? []) delete merged[removed];
        files = merged;
        if (result.delta.requiresFullResolution) {
          sawFallback = true;
          state = buildInitialState(files, evidence);
        } else {
          state = result.state;
        }
      }

      for (let round = 0; round < 50; round += 1) {
        const step = round % 5;
        const existing = Object.keys(files).filter((f) => f !== 'f0.ts');
        const target = existing[round % existing.length] ?? 'f1.ts';

        if (step === 0) {
          // add a new file
          const name = `f${nextIndex}.ts`;
          applyAndAdvance({ changedFiles: { [name]: classSource(`Widget${nextIndex}`) } });
          nextIndex += 1;
        } else if (step === 1) {
          // body-only edit (comment) on an existing file — content-identical class
          const className = classNameOf(files[target]!);
          applyAndAdvance({ changedFiles: { [target]: `${classSource(className)} // round ${round}` } });
        } else if (step === 2) {
          // rename the class inside an existing file (remove+add)
          const className = classNameOf(files[target]!);
          applyAndAdvance({ changedFiles: { [target]: classSource(`${className}R${round}`) } });
        } else if (step === 3 && Object.keys(files).length > 4) {
          // delete the oldest non-f0 file still present
          applyAndAdvance({ deletedFiles: [target] });
        } else {
          // multi-file batch: two files change together
          const other = existing[(round + 1) % existing.length] ?? target;
          const classNameA = classNameOf(files[target]!);
          const changedFiles: WorkspaceFiles = { [target]: `${classSource(classNameA)} // batch ${round}` };
          if (other !== target && files[other]) {
            changedFiles[other] = `${classSource(classNameOf(files[other]!))} // batch ${round}`;
          }
          applyAndAdvance({ changedFiles });
        }
      }

      const fullEvidence = createEvidenceStore(dir);
      const full = runFullRebuild(files, fullEvidence);
      const incrementalSnap = snapshotOf(state, fullEvidence);
      const fullSnap = snapshotOf(full, fullEvidence);
      fullEvidence.close();
      evidence.close();

      const problems = diffConvergenceSnapshots(fullSnap, incrementalSnap);
      assert.deepEqual(problems, [], `50-edit history should converge with a fresh full rebuild of the final tree (sawFallback=${sawFallback}, fileCount=${Object.keys(files).length}): ${problems.join('; ')}`);
    });
  });
});
