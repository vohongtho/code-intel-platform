/**
 * copy-grammars.mjs
 *
 * Copies the dylink.0-format WASM grammars for Swift, Kotlin, and Dart into
 * dist/wasm/ so they are always present relative to the bundled output files.
 *
 * Resolution from the bundled JS:
 *   dist/index.js         → import.meta.url dirname = dist/  → ./wasm/
 *   dist/cli/main.js      → import.meta.url dirname = dist/cli/ → ../wasm/
 *
 * Run automatically as part of `npm run build`.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const destDir = path.join(__dirname, '..', 'dist', 'wasm');

const req = createRequire(import.meta.url);

const grammars = [
  { pkg: 'tree-sitter-swift/tree-sitter-swift.wasm',   dest: 'tree-sitter-swift.wasm' },
  { pkg: 'tree-sitter-kotlin/tree-sitter-kotlin.wasm', dest: 'tree-sitter-kotlin.wasm' },
  { pkg: 'tree-sitter-dart/tree-sitter-dart.wasm',     dest: 'tree-sitter-dart.wasm' },
];

fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const { pkg, dest } of grammars) {
  const dst = path.join(destDir, dest);

  // 1. Try resolving the WASM from the npm package
  try {
    const src = req.resolve(pkg);
    fs.copyFileSync(src, dst);
    console.log(`  ✓ copied ${pkg} → dist/wasm/${dest}`);
    copied++;
    continue;
  } catch {
    // Package not installed or doesn't ship a WASM — try bundled fallback
  }

  // 2. Fall back to the pre-bundled wasm/ directory in this package
  const bundledSrc = path.join(__dirname, '..', 'wasm', dest);
  if (fs.existsSync(bundledSrc)) {
    fs.copyFileSync(bundledSrc, dst);
    console.log(`  ✓ copied (bundled) ${dest} → dist/wasm/${dest}`);
    copied++;
  } else {
    console.warn(`  ⚠ ${pkg} not found, skipping (no npm wasm and no bundled fallback)`);
  }
}

if (copied === 0) {
  console.warn('  ⚠ No grammar WASMs were copied. Swift/Kotlin/Dart will fall back to regex.');
} else {
  console.log(`  ✓ ${copied}/${grammars.length} grammar WASMs ready in dist/wasm/`);
}

// ─── Also copy the web UI dist into dist/web/ ─────────────────────────────────
const webSrc = path.join(__dirname, '..', '..', 'web', 'dist');
const webDest = path.join(__dirname, '..', 'dist', 'web');

if (fs.existsSync(webSrc)) {
  fs.mkdirSync(webDest, { recursive: true });
  // Recursive copy helper
  function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) copyDir(srcPath, dstPath);
      else fs.copyFileSync(srcPath, dstPath);
    }
  }
  copyDir(webSrc, webDest);
  console.log('  ✓ web UI copied → dist/web/');
} else {
  console.warn('  ⚠ web/dist not found — run npm run build in code-intel/web first');
}
