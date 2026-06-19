/**
 * router.ts — Tiny entry point for the `code-intel` binary.
 *
 * Startup cost of THIS file: ~50 ms (no heavy imports).
 *
 * Fast commands (have a dedicated slim bundle) are dispatched by spawning
 * node with the slim binary — avoiding parsing the 800 KB main.js.
 *
 * All other commands fall through to main.js via dynamic import.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Commands that have a dedicated slim bundle.
 * Key   = argv[2] (sub-command name).
 * Value = path to the slim dist file relative to this router's directory.
 */
const SLIM_DISPATCH: Readonly<Record<string, string>> = {
  search: join(__dir, 'search.js'),
};

const cmd = process.argv[2];
const slimBin = cmd ? SLIM_DISPATCH[cmd] : undefined;

if (slimBin) {
  // Dispatch to slim binary.
  // Strip the sub-command token (argv[2]) — slim binary parses from argv[2] onward.
  const child = spawn(
    process.execPath,
    [slimBin, ...process.argv.slice(3)],
    { stdio: 'inherit', env: process.env },
  );
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', () => {
    // Slim binary failed to launch — fall through to main.js
    const main = join(__dir, 'main.js');
    const fb = spawn(process.execPath, [main, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
    fb.on('close', (c) => process.exit(c ?? 0));
  });
} else {
  // All other commands: spawn main.js (dynamic import would cause esbuild to bundle it).
  const main = join(__dir, 'main.js');
  const child = spawn(process.execPath, [main, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (err) => { console.error(err.message); process.exit(1); });
}
