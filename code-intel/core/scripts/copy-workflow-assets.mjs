/**
 * copy-workflow-assets.mjs
 *
 * Copies the workflow markdown source assets (src/agents/workflows/assets/*.md)
 * into dist/agents/workflows/assets/ so `installer.ts`'s runtime
 * `fs.readFileSync(path.join(__dirname, manifest.assetPath))` can find them
 * from the compiled dist/agents/workflows/installer.js — tsup only compiles
 * .ts sources, it does not copy arbitrary asset files on its own.
 *
 * Run automatically as part of `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src', 'agents', 'workflows', 'assets');
// Default target is dist/ (production build output). Pass an argument (e.g.
// "dist-tests/src") to also mirror the assets next to the test build output,
// since `tsc -b tsconfig.test.json` compiles .ts/.js but does not copy
// non-source files, and installer.ts resolves assets relative to its own
// compiled location at runtime.
const destRoot = process.argv[2] ?? 'dist';
const destDir = path.join(__dirname, '..', destRoot, 'agents', 'workflows', 'assets');

fs.mkdirSync(destDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}
console.log(`  ✓ ${files.length} workflow asset(s) copied → ${destRoot}/agents/workflows/assets/`);
