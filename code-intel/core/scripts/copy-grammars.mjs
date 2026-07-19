/**
 * copy-grammars.mjs
 *
 * Copies language WASM grammars into dist/wasm/ so published installs do not
 * depend on the grammar npm packages being present at runtime.
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
  { pkg: 'tree-sitter-typescript/tree-sitter-typescript.wasm', dest: 'tree-sitter-typescript.wasm' },
  { pkg: 'tree-sitter-javascript/tree-sitter-javascript.wasm', dest: 'tree-sitter-javascript.wasm' },
  { pkg: 'tree-sitter-python/tree-sitter-python.wasm', dest: 'tree-sitter-python.wasm' },
  { pkg: 'tree-sitter-java/tree-sitter-java.wasm', dest: 'tree-sitter-java.wasm' },
  { pkg: 'tree-sitter-go/tree-sitter-go.wasm', dest: 'tree-sitter-go.wasm' },
  { pkg: 'tree-sitter-c/tree-sitter-c.wasm', dest: 'tree-sitter-c.wasm' },
  { pkg: 'tree-sitter-cpp/tree-sitter-cpp.wasm', dest: 'tree-sitter-cpp.wasm' },
  { pkg: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm', dest: 'tree-sitter-c_sharp.wasm' },
  { pkg: 'tree-sitter-rust/tree-sitter-rust.wasm', dest: 'tree-sitter-rust.wasm' },
  { pkg: 'tree-sitter-php/tree-sitter-php.wasm', dest: 'tree-sitter-php.wasm' },
  { pkg: 'tree-sitter-ruby/tree-sitter-ruby.wasm', dest: 'tree-sitter-ruby.wasm' },
  { pkg: 'tree-sitter-swift/tree-sitter-swift.wasm', dest: 'tree-sitter-swift.wasm' },
  { pkg: 'tree-sitter-kotlin/tree-sitter-kotlin.wasm', dest: 'tree-sitter-kotlin.wasm' },
  { pkg: 'tree-sitter-dart/tree-sitter-dart.wasm', dest: 'tree-sitter-dart.wasm' },
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
  console.warn('  ⚠ No grammar WASMs were copied. Tree-sitter parsing will be unavailable.');
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
