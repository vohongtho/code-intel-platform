import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DIST_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SQLITE_MODULE = path.join(DIST_ROOT, 'src', 'shared', 'sqlite.js');

describe('sqlite warning suppression', () => {
  it('suppresses only the node:sqlite ExperimentalWarning during module load', () => {
    const script = `
      const seen = [];
      process.emitWarning = ((orig) => (warning, ...args) => {
        const message = typeof warning === 'string' ? warning : warning.message;
        const type = typeof args[0] === 'string' ? args[0] : '';
        seen.push({ message, type });
        return orig.call(process, warning, ...args);
      })(process.emitWarning);
      await import(${JSON.stringify(SQLITE_MODULE)});
      process.emitWarning('keep me', 'Warning');
      console.log(JSON.stringify(seen));
    `;

    const stdout = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const seen = JSON.parse(stdout.trim()) as Array<{ message: string; type: string }>;
    assert.equal(seen.some((entry) => entry.message.includes('SQLite is an experimental feature')), false);
    assert.equal(seen.some((entry) => entry.message === 'keep me' && entry.type === 'Warning'), true);
  });

  it('suppresses the node:sqlite ExperimentalWarning during Database construction', () => {
    const script = `
      const seen = [];
      process.emitWarning = ((orig) => (warning, ...args) => {
        const message = typeof warning === 'string' ? warning : warning.message;
        const type = typeof args[0] === 'string' ? args[0] : '';
        seen.push({ message, type });
        return orig.call(process, warning, ...args);
      })(process.emitWarning);
      const mod = await import(${JSON.stringify(SQLITE_MODULE)});
      new mod.Database(':memory:');
      process.emitWarning('keep me too', 'Warning');
      console.log(JSON.stringify(seen));
    `;

    const stdout = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const seen = JSON.parse(stdout.trim()) as Array<{ message: string; type: string }>;
    assert.equal(seen.some((entry) => entry.message.includes('SQLite is an experimental feature')), false);
    assert.equal(seen.some((entry) => entry.message === 'keep me too' && entry.type === 'Warning'), true);
  });
});
