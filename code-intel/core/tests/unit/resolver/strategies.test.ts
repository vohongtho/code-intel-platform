import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { relativePathStrategy } from '../../../src/resolver/strategies/relative-path.js';
import { packageLookupStrategy } from '../../../src/resolver/strategies/package-lookup.js';
import { namespaceAliasStrategy } from '../../../src/resolver/strategies/namespace-alias.js';
import { wildcardExpandStrategy } from '../../../src/resolver/strategies/wildcard-expand.js';
import type { ResolveContext } from '../../../src/resolver/strategies/types.js';

function makeContext(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    workspaceRoot: '/workspace',
    fileExists: () => false,
    resolve: (_fromDir: string, rel: string) => `/workspace/${rel.replace(/^\.\//, '')}`,
    findByPackage: () => null,
    ...overrides,
  };
}

describe('relativePathStrategy', () => {
  it('returns null for non-relative path', () => {
    const ctx = makeContext();
    const result = relativePathStrategy.resolve('lodash', '/src/foo.ts', ctx);
    assert.equal(result, null);
  });

  it('resolves relative path using context.resolve', () => {
    const resolved = '/src/utils.ts';
    const ctx = makeContext({ resolve: () => resolved });
    const result = relativePathStrategy.resolve('./utils', '/src/foo.ts', ctx);
    assert.equal(result, resolved);
  });

  it('strips single quotes from path', () => {
    let capturedRel = '';
    const ctx = makeContext({ resolve: (_dir, rel) => { capturedRel = rel; return '/out'; } });
    relativePathStrategy.resolve("'./helper'", '/src/foo.ts', ctx);
    assert.ok(!capturedRel.includes("'"));
    assert.ok(capturedRel.startsWith('.'));
  });

  it('strips double quotes from path', () => {
    let capturedRel = '';
    const ctx = makeContext({ resolve: (_dir, rel) => { capturedRel = rel; return '/out'; } });
    relativePathStrategy.resolve('"./helper"', '/src/foo.ts', ctx);
    assert.ok(!capturedRel.includes('"'));
  });

  it('passes dirname of fromFile to context.resolve', () => {
    let capturedFromDir = '';
    const ctx = makeContext({ resolve: (fromDir, _rel) => { capturedFromDir = fromDir; return '/out'; } });
    relativePathStrategy.resolve('./utils', '/src/components/button.ts', ctx);
    assert.equal(capturedFromDir, '/src/components');
  });

  it('has name "relative-path"', () => {
    assert.equal(relativePathStrategy.name, 'relative-path');
  });
});

describe('packageLookupStrategy', () => {
  it('returns null for relative path', () => {
    const ctx = makeContext();
    const result = packageLookupStrategy.resolve('./local', '/src/foo.ts', ctx);
    assert.equal(result, null);
  });

  it('resolves package via findByPackage', () => {
    const ctx = makeContext({ findByPackage: (pkg) => `/node_modules/${pkg}/index.js` });
    const result = packageLookupStrategy.resolve('lodash', '/src/foo.ts', ctx);
    assert.ok(result !== null);
    assert.ok(result!.includes('lodash'));
  });

  it('returns null when package not found', () => {
    const ctx = makeContext({ findByPackage: () => null });
    const result = packageLookupStrategy.resolve('unknown-pkg', '/src/foo.ts', ctx);
    assert.equal(result, null);
  });

  it('strips quotes before calling findByPackage', () => {
    let capturedPkg = '';
    const ctx = makeContext({ findByPackage: (pkg) => { capturedPkg = pkg; return null; } });
    packageLookupStrategy.resolve('"lodash"', '/src/foo.ts', ctx);
    assert.ok(!capturedPkg.includes('"'));
    assert.equal(capturedPkg, 'lodash');
  });

  it('has name "package-lookup"', () => {
    assert.equal(packageLookupStrategy.name, 'package-lookup');
  });
});

describe('namespaceAliasStrategy', () => {
  it('tries /__init__.py suffix for dotted namespace', () => {
    const tried: string[] = [];
    const ctx = makeContext({
      findByPackage: (pkg) => {
        tried.push(pkg);
        return pkg.endsWith('/__init__.py') ? `/src/${pkg}` : null;
      },
    });
    const result = namespaceAliasStrategy.resolve('my.module', '/src/foo.py', ctx);
    assert.ok(result !== null);
    assert.ok(tried.some((t) => t.endsWith('/__init__.py')));
  });

  it('returns null when no suffix matches', () => {
    const ctx = makeContext({ findByPackage: () => null });
    const result = namespaceAliasStrategy.resolve('missing.module', '/src/foo.py', ctx);
    assert.equal(result, null);
  });

  it('falls back to bare slash-path when no suffix matches', () => {
    let lastCalled = '';
    const ctx = makeContext({ findByPackage: (pkg) => { lastCalled = pkg; return null; } });
    namespaceAliasStrategy.resolve('my.pkg', '/src/foo.ts', ctx);
    assert.equal(lastCalled, 'my/pkg');
  });

  it('has name "namespace-alias"', () => {
    assert.equal(namespaceAliasStrategy.name, 'namespace-alias');
  });

  it('converts dotted path to slash-separated', () => {
    const tried: string[] = [];
    const ctx = makeContext({ findByPackage: (pkg) => { tried.push(pkg); return null; } });
    namespaceAliasStrategy.resolve('a.b.c', '/src/foo.py', ctx);
    assert.ok(tried.some((t) => t.startsWith('a/b/c')));
  });
});

describe('wildcardExpandStrategy', () => {
  it('resolves via findByPackage', () => {
    const ctx = makeContext({ findByPackage: (pkg) => `/src/${pkg}` });
    const result = wildcardExpandStrategy.resolve('some.package', '/src/foo.ts', ctx);
    assert.ok(result !== null);
  });

  it('returns null when not found', () => {
    const ctx = makeContext({ findByPackage: () => null });
    const result = wildcardExpandStrategy.resolve('missing', '/src/foo.ts', ctx);
    assert.equal(result, null);
  });

  it('strips quotes from path', () => {
    let capturedPkg = '';
    const ctx = makeContext({ findByPackage: (pkg) => { capturedPkg = pkg; return null; } });
    wildcardExpandStrategy.resolve("'my-pkg'", '/src/foo.ts', ctx);
    assert.ok(!capturedPkg.includes("'"));
    assert.equal(capturedPkg, 'my-pkg');
  });

  it('has name "wildcard-expand"', () => {
    assert.equal(wildcardExpandStrategy.name, 'wildcard-expand');
  });
});
