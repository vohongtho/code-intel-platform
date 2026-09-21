import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveStableCliCommand, resolveStableHookCommand, resolveStableMcpConfig } from '../../../src/cli/runtime-command.js';

describe('runtime command resolution', () => {
  it('falls back to bundled launcher-relative path when script path looks bundled', () => {
    const scriptPath = '/tmp/install/current/app/code-intel/core/dist/cli/main.js';
    assert.equal(resolveStableCliCommand(scriptPath), path.resolve('/tmp/install/bin/code-intel'));
    assert.match(resolveStableHookCommand('claude', scriptPath), /hook claude$/);
    assert.deepEqual(resolveStableMcpConfig('/tmp/repo', scriptPath), {
      command: path.resolve('/tmp/install/bin/code-intel'),
      args: ['mcp', '/tmp/repo'],
    });
  });

  it('falls back to code-intel when not bundled', () => {
    const scriptPath = path.resolve('code-intel/core/dist/cli/main.js');
    assert.equal(resolveStableCliCommand(scriptPath), 'code-intel');
    assert.equal(resolveStableHookCommand('claude', scriptPath), 'code-intel hook claude');
    assert.deepEqual(resolveStableMcpConfig('/tmp/repo', scriptPath), {
      command: 'code-intel',
      args: ['mcp', '/tmp/repo'],
    });
  });

  it('uses CODE_INTEL_BUNDLED_CURRENT_ROOT when provided', () => {
    const scriptPath = '/tmp/other/current/app/code-intel/core/dist/cli/main.js';
    const previous = process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT;
    process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT = '/tmp/install/current';
    try {
      assert.equal(resolveStableCliCommand(scriptPath), path.resolve('/tmp/install/bin/code-intel'));
      assert.match(resolveStableHookCommand('copilot', scriptPath), /hook copilot$/);
      assert.deepEqual(resolveStableMcpConfig('/tmp/repo', scriptPath), {
        command: path.resolve('/tmp/install/bin/code-intel'),
        args: ['mcp', '/tmp/repo'],
      });
    } finally {
      if (previous === undefined) delete process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT;
      else process.env.CODE_INTEL_BUNDLED_CURRENT_ROOT = previous;
    }
  });
});
