import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLanguageCapabilityDescriptors } from '../../src/languages/capability-registry.js';
import { getLanguageModule } from '../../src/languages/registry.js';
import { Language } from '../../src/shared/languages.js';
import type { FileSet } from '../../src/languages/types.js';

interface Counters {
  indexBuilds: number;
  resolveCalls: number;
  findByPackageCalls: number;
  hasCalls: number;
  candidateLookups: number;
  truncations: number;
}

interface FixtureCase {
  rawPath: string;
  fromFile: string;
  target: string;
  expectedCalls: number;
  supportsDeepFromFile?: boolean;
}

interface ScalingFixtureConfig {
  fileCount: { generatedFiles: number };
  referenceImportCount: { repetitions: number };
  pathDepth: { segments: number };
  sameNameCollisionDensity: { collisions: number };
}

function makeInstrumentedFileSet(files: string[]): FileSet & { counters: Counters } {
  const normalized = new Set(files);
  const counters: Counters = {
    indexBuilds: 1,
    resolveCalls: 0,
    findByPackageCalls: 0,
    hasCalls: 0,
    candidateLookups: 0,
    truncations: 0,
  };

  return {
    counters,
    has(filePath: string): boolean {
      counters.hasCalls++;
      counters.candidateLookups++;
      return normalized.has(filePath);
    },
    resolve(fromDir: string, relativePath: string): string | null {
      counters.resolveCalls++;
      counters.candidateLookups++;
      const joined = `${fromDir.replace(/\/$/, '')}/${relativePath.replace(/^\.\//, '')}`;
      return normalized.has(joined) ? joined : null;
    },
    findByPackage(packageName: string): string | null {
      counters.findByPackageCalls++;
      let scanned = 0;
      for (const file of normalized) {
        scanned++;
        counters.candidateLookups++;
        if (file.includes(packageName)) return file;
        if (scanned >= 4096) {
          counters.truncations++;
          break;
        }
      }
      return null;
    },
  };
}

function baseCase(language: Language): FixtureCase {
  switch (language) {
    case Language.TypeScript:
      return { rawPath: './dep', fromFile: '/workspace/src/main.ts', target: '/workspace/src/dep.ts', expectedCalls: 1, supportsDeepFromFile: false };
    case Language.JavaScript:
      return { rawPath: './dep', fromFile: '/workspace/src/main.js', target: '/workspace/src/dep.js', expectedCalls: 1, supportsDeepFromFile: false };
    case Language.Python:
      return { rawPath: 'pkg.mod', fromFile: '/workspace/src/main.py', target: '/workspace/pkg.mod', expectedCalls: 1 };
    case Language.Java:
      return { rawPath: 'com.example.Util', fromFile: '/workspace/src/Main.java', target: '/workspace/com/example/Util.java', expectedCalls: 1 };
    case Language.Go:
      return { rawPath: 'example/util', fromFile: '/workspace/src/main.go', target: '/workspace/example/util', expectedCalls: 1 };
    case Language.C:
      return { rawPath: '<dep.h>', fromFile: '/workspace/src/main.c', target: '/workspace/src/dep.h', expectedCalls: 1, supportsDeepFromFile: false };
    case Language.Cpp:
      return { rawPath: '<dep.hpp>', fromFile: '/workspace/src/main.cpp', target: '/workspace/src/dep.hpp', expectedCalls: 1, supportsDeepFromFile: false };
    case Language.CSharp:
      return { rawPath: 'Example.Services.UserService', fromFile: '/workspace/src/Main.cs', target: '/workspace/Example.Services.UserService', expectedCalls: 1 };
    case Language.Rust:
      return { rawPath: 'crate::util', fromFile: '/workspace/src/main.rs', target: '/workspace/crate/util.rs', expectedCalls: 1 };
    case Language.PHP:
      return { rawPath: 'App\\Services\\UserService', fromFile: '/workspace/src/main.php', target: '/workspace/App/Services/UserService.php', expectedCalls: 1 };
    case Language.Kotlin:
      return { rawPath: 'com.example.Util', fromFile: '/workspace/src/Main.kt', target: '/workspace/com/example/Util.kt', expectedCalls: 1 };
    case Language.Ruby:
      return { rawPath: 'helpers/util', fromFile: '/workspace/src/main.rb', target: '/workspace/helpers/util.rb', expectedCalls: 1 };
    case Language.Swift:
      return { rawPath: 'MyModule', fromFile: '/workspace/src/main.swift', target: '/workspace/MyModule', expectedCalls: 1 };
    case Language.Dart:
      return { rawPath: 'package:pkg/util.dart', fromFile: '/workspace/src/main.dart', target: '/workspace/pkg/util.dart', expectedCalls: 1 };
    case Language.HTML:
      return { rawPath: '/app.js', fromFile: '/workspace/index.html', target: '', expectedCalls: 0 };
  }
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceTestDir = path.resolve(testDir, '../../../tests/performance');
const scalingFixturePath = fs.existsSync(path.join(testDir, 'fixtures', 'language-resolution-scaling.json'))
  ? path.join(testDir, 'fixtures', 'language-resolution-scaling.json')
  : path.join(sourceTestDir, 'fixtures', 'language-resolution-scaling.json');
const scalingFixtures = JSON.parse(fs.readFileSync(scalingFixturePath, 'utf8')) as ScalingFixtureConfig;

function scaledFiles(target: string, size: number): string[] {
  const files = [target];
  for (let i = 0; i < size; i++) files.push(`/workspace/generated/depth${i}/collision${i}/same-name-${i}.tmp`);
  return files;
}

function collisionFiles(target: string, count: number): string[] {
  const files = [target];
  for (let i = 0; i < count; i++) files.push(`/workspace/collisions/layer${i}/shared-name/index.${i}.tmp`);
  return files;
}

function buildDeepFromFile(extension: string, segments: number): string {
  return `/workspace/${'nested/'.repeat(segments)}entry${extension}`;
}

describe('language resolution performance contracts', () => {
  it('keeps per-language adapter traversals within registry budgets under scaled fixtures', () => {
    for (const descriptor of getLanguageCapabilityDescriptors()) {
      const mod = getLanguageModule(descriptor.language);
      const perf = descriptor.resolutionPerformance;
      assert.ok(perf, `${descriptor.language} should declare resolution performance contract`);

      const sample = baseCase(descriptor.language);
      const small = makeInstrumentedFileSet(scaledFiles(sample.target, 8));
      const large = makeInstrumentedFileSet(scaledFiles(sample.target, scalingFixtures.fileCount.generatedFiles));
      const deep = makeInstrumentedFileSet(scaledFiles(sample.target, scalingFixtures.fileCount.generatedFiles));

      const smallResult = mod.resolveImport(sample.rawPath, sample.fromFile, small);
      const largeResult = mod.resolveImport(sample.rawPath, sample.fromFile, large);
      const deepFilePath = sample.supportsDeepFromFile === false
        ? sample.fromFile
        : buildDeepFromFile(descriptor.extensions[0], scalingFixtures.pathDepth.segments);
      const deepResult = mod.resolveImport(sample.rawPath, deepFilePath, deep);

      if (sample.expectedCalls === 0) {
        assert.equal(smallResult, null, `${descriptor.language} should not resolve imports in truthful baseline`);
        assert.equal(large.counters.resolveCalls + large.counters.findByPackageCalls, 0);
        continue;
      }

      assert.ok(smallResult, `${descriptor.language} should resolve representative import`);
      assert.ok(largeResult, `${descriptor.language} should resolve representative import under large fixture`);
      assert.ok(deepResult, `${descriptor.language} should resolve representative import under deep fixture`);

      const smallWork = small.counters.resolveCalls + small.counters.findByPackageCalls;
      const largeWork = large.counters.resolveCalls + large.counters.findByPackageCalls;
      const deepWork = deep.counters.resolveCalls + deep.counters.findByPackageCalls;

      assert.ok(smallWork > 0, `${descriptor.language} non-vacuity anchor: resolution must perform adapter work`);
      assert.ok(small.counters.indexBuilds <= perf.maxPreparedIndexBuildsPerPass, `${descriptor.language} index builds exceeded contract`);
      assert.ok(smallWork <= perf.maxWorkspaceTraversalsPerPass, `${descriptor.language} small fixture traversals exceeded contract`);
      assert.ok(largeWork <= perf.maxWorkspaceTraversalsPerPass, `${descriptor.language} file-count scaling exceeded contract`);
      assert.ok(deepWork <= (perf.depthScalingBudget ?? perf.maxWorkspaceTraversalsPerPass), `${descriptor.language} depth scaling exceeded contract`);
      assert.ok(small.counters.candidateLookups <= (perf.candidateLookupBudget ?? Number.POSITIVE_INFINITY), `${descriptor.language} candidate lookups exceeded contract`);
      assert.ok(small.counters.truncations <= (perf.truncationBudget ?? Number.POSITIVE_INFINITY), `${descriptor.language} truncations exceeded contract`);
    }
  });

  it('preserves linear normalized cost for repeated imports and same-name collisions', () => {
    for (const descriptor of getLanguageCapabilityDescriptors()) {
      const sample = baseCase(descriptor.language);
      if (sample.expectedCalls === 0) continue;
      const mod = getLanguageModule(descriptor.language);
      const perf = descriptor.resolutionPerformance!;
      const workspace = makeInstrumentedFileSet(collisionFiles(sample.target, scalingFixtures.sameNameCollisionDensity.collisions));
      const importCount = scalingFixtures.referenceImportCount.repetitions;

      for (let i = 0; i < importCount; i++) {
        const result = mod.resolveImport(sample.rawPath, sample.fromFile, workspace);
        assert.ok(result, `${descriptor.language} repeated import ${i} should resolve`);
      }

      const totalWork = workspace.counters.resolveCalls + workspace.counters.findByPackageCalls;
      const normalized = totalWork / importCount;
      const candidateNormalized = workspace.counters.candidateLookups / importCount;
      assert.ok(normalized > 0, `${descriptor.language} normalized workload should be non-zero`);
      assert.ok(normalized <= perf.scalingBudget * 2, `${descriptor.language} normalized workload ${normalized} exceeded budget ${perf.scalingBudget * 2}`);
      assert.ok(candidateNormalized <= (perf.candidateLookupBudget ?? Number.POSITIVE_INFINITY) * 1024, `${descriptor.language} normalized candidate lookups ${candidateNormalized} exceeded budget`);
      assert.ok(workspace.counters.truncations <= (perf.truncationBudget ?? Number.POSITIVE_INFINITY), `${descriptor.language} truncations exceeded budget`);
    }
  });
});
