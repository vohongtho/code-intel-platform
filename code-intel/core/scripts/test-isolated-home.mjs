// Preloaded into every test process (`node --import ./scripts/test-isolated-home.mjs --test …`).
// Points HOME at a throwaway directory before any module reads it, so tests — and the CLI
// children they spawn, which inherit this environment — never read or write the developer's
// real ~/.code-intel (repo registry, groups, config, users DB, logs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.CODE_INTEL_TEST_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-test-home-'));
  process.env.CODE_INTEL_TEST_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.on('exit', () => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });
}
