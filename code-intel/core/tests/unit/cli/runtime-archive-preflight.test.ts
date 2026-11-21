import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preflightRuntimeArchive, DEFAULT_ARCHIVE_PREFLIGHT_LIMITS } from '../../../src/cli/runtime-archive-preflight.js';
import { buildTarGz, type TarFixtureEntry } from './runtime-fixtures.js';

async function preflight(entries: TarFixtureEntry[], limits = DEFAULT_ARCHIVE_PREFLIGHT_LIMITS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  try {
    const archive = path.join(dir, 'a.tar.gz');
    fs.writeFileSync(archive, buildTarGz(entries));
    return await preflightRuntimeArchive(archive, limits);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('runtime archive preflight', () => {
  it('accepts a well-formed single-root archive with an internal symlink', async () => {
    const result = await preflight([
      { name: 'rt/', type: '5' },
      { name: 'rt/bin/node', data: 'x' },
      { name: 'rt/bin/npm', type: '2', linkname: '../lib/npm-cli.js' },
      { name: 'rt/lib/npm-cli.js', data: 'y' },
    ]);
    assert.deepEqual(result, { topLevel: 'rt', entries: 4, totalBytes: 2, symlinks: 1 });
  });

  it('accepts an archive written by system tar, including GNU long names', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-gnu-'));
    try {
      const deep = path.join(dir, 'rt', 'a'.repeat(60), 'b'.repeat(60));
      fs.mkdirSync(deep, { recursive: true });
      fs.writeFileSync(path.join(deep, 'c'.repeat(40)), 'data');
      fs.symlinkSync('x', path.join(dir, 'rt', 'link'));
      fs.writeFileSync(path.join(dir, 'rt', 'x'), 'x');
      const archive = path.join(dir, 'a.tar.gz');
      execFileSync('tar', ['-czf', archive, '-C', dir, 'rt']);
      const result = await preflightRuntimeArchive(archive);
      assert.equal(result.topLevel, 'rt');
      assert.equal(result.symlinks, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const rejects: Array<[string, TarFixtureEntry[], RegExp]> = [
    ['absolute path', [{ name: '/etc/passwd', data: 'x' }], /absolute/],
    ['parent traversal', [{ name: 'rt/' , type: '5' }, { name: 'rt/../../evil', data: 'x' }], /parent traversal/],
    ['symlink escaping the root', [{ name: 'rt/l', type: '2', linkname: '../../etc' }], /escapes/],
    ['absolute symlink target', [{ name: 'rt/l', type: '2', linkname: '/etc' }], /unsafe symlink/],
    ['symlink escaping through another archive symlink', [
      { name: 'rt/a/b/l1', type: '2', linkname: '../..' },
      { name: 'rt/l2', type: '2', linkname: 'a/b/l1/../../outside' },
    ], /escapes/],
    ['symlink loop', [{ name: 'rt/x', type: '2', linkname: 'y' }, { name: 'rt/y', type: '2', linkname: 'x' }], /too many levels/],
    ['entry written through a symlink', [{ name: 'rt/d', type: '2', linkname: '.' }, { name: 'rt/d/x', data: 'x' }], /nested under symlink/],
    ['hard link outside the archive', [{ name: 'rt/h', type: '1', linkname: 'etc/passwd' }], /hard link/],
    ['character device', [{ name: 'rt/dev', type: '3' }], /unsupported entry type '3'/],
    ['FIFO', [{ name: 'rt/fifo', type: '6' }], /unsupported entry type '6'/],
    ['two top-level directories', [{ name: 'a/x', data: '1' }, { name: 'b/y', data: '2' }], /more than one top-level/],
    ['backslash path', [{ name: 'rt\\..\\x', data: '1' }], /forbidden character/],
    ['GNU long name with traversal', [{ name: '././@LongLink', type: 'L', data: 'rt/../../escape\0' }, { name: 'placeholder', data: 'x' }], /parent traversal/],
  ];
  for (const [label, entries, pattern] of rejects) {
    it(`rejects ${label}`, async () => {
      await assert.rejects(preflight(entries), pattern);
    });
  }

  it('enforces entry-count and size bounds', async () => {
    const entries = [{ name: 'rt/a', data: '1' }, { name: 'rt/b', data: '2' }, { name: 'rt/c', data: '3' }];
    await assert.rejects(preflight(entries, { ...DEFAULT_ARCHIVE_PREFLIGHT_LIMITS, maxEntries: 2 }), /more than 2 entries/);
    await assert.rejects(preflight([{ name: 'rt/big', data: 'x'.repeat(100) }], { ...DEFAULT_ARCHIVE_PREFLIGHT_LIMITS, maxEntryBytes: 10 }), /exceeds 10 bytes/);
    await assert.rejects(preflight(entries, { ...DEFAULT_ARCHIVE_PREFLIGHT_LIMITS, maxTotalBytes: 2 }), /expanded size/);
  });

  it('rejects corrupt and non-gzip input', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-bad-'));
    try {
      const notGzip = path.join(dir, 'x.tar.gz');
      fs.writeFileSync(notGzip, 'not an archive');
      await assert.rejects(preflightRuntimeArchive(notGzip), /could not be read/);
      const good = buildTarGz([{ name: 'rt/a', data: 'x'.repeat(2000) }]);
      const truncated = path.join(dir, 't.tar.gz');
      fs.writeFileSync(truncated, good.subarray(0, Math.floor(good.length / 2)));
      await assert.rejects(preflightRuntimeArchive(truncated), /ARCHIVE_UNSAFE/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
