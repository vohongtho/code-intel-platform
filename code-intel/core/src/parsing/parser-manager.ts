import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { existsSync } from 'node:fs';
import { Language } from '../shared/index.js';
import { getLanguageCapabilityDescriptor } from '../languages/capability-registry.js';
import { Parser, Language as TSLanguage } from 'web-tree-sitter';

const _require = createRequire(import.meta.url);

/**
 * Locate the bundled wasm/ directory at runtime.
 *
 * tsup compiles parser-manager.ts into two bundles:
 *   dist/index.js      → import.meta.url dirname = dist/   → ./wasm  = dist/wasm/ ✅
 *   dist/cli/main.js   → import.meta.url dirname = dist/cli → ../wasm = dist/wasm/ ✅
 *
 * We try both candidates and return the first that exists.
 */
function findBundledWasmDir(): string {
  const fileDir = nodePath.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    nodePath.join(fileDir, 'wasm'),    // dist/index.js → dist/wasm/
    nodePath.join(fileDir, '../wasm'), // dist/cli/main.js → dist/wasm/
    nodePath.join(fileDir, '../app/code-intel/core/dist/wasm'),
    nodePath.join(fileDir, '../../app/code-intel/core/dist/wasm'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]; // fallback (will just not find files)
}

const _bundledWasmDir = findBundledWasmDir();

/**
 * Resolve the absolute path to a language WASM file.
 *
 * Published builds prefer wasm files bundled into dist/wasm/ so end users do
 * not need the language grammar npm packages at install time.
 *
 * For local source/dev runs we still support resolving the grammar package's
 * wasm directly from node_modules as a fallback.
 */
function wasmPath(lang: Language): string | null {
  const descriptor = getLanguageCapabilityDescriptor(lang);

  const bundledPath = nodePath.join(_bundledWasmDir, descriptor.grammarArtifact);
  if (existsSync(bundledPath)) return bundledPath;

  try {
    return _require.resolve(descriptor.devGrammarPackage);
  } catch {
    return null;
  }
}

let initPromise: Promise<void> | null = null;

/** Initialize web-tree-sitter (idempotent). */
export async function initParser(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

const languageCache = new Map<Language, TSLanguage | null>();
const parserCache   = new Map<Language, Parser>();

/**
 * Load and cache the TSLanguage WASM for a given language.
 * Returns null when no WASM grammar is available for this language.
 */
export async function getLanguage(lang: Language): Promise<TSLanguage | null> {
  if (languageCache.has(lang)) return languageCache.get(lang)!;

  const path = wasmPath(lang);
  if (!path) {
    languageCache.set(lang, null);
    return null;
  }

  try {
    await initParser();
    const language = await TSLanguage.load(path);
    languageCache.set(lang, language);
    return language;
  } catch {
    languageCache.set(lang, null);
    return null;
  }
}

/**
 * Get a Parser instance configured for the given language.
 * Returns null when no WASM grammar is available.
 */
export async function getParser(lang: Language): Promise<Parser | null> {
  const language = await getLanguage(lang);
  if (!language) return null;

  let parser = parserCache.get(lang);
  if (!parser) {
    parser = new Parser();
    parserCache.set(lang, parser);
  }
  parser.setLanguage(language);
  return parser;
}

/**
 * Parse source code for the given language.
 * Returns a Tree or null when the language is unsupported / WASM fails.
 */
export async function parseSource(
  lang: Language,
  source: string,
): Promise<import('web-tree-sitter').Tree | null> {
  const parser = await getParser(lang);
  if (!parser) return null;
  return parser.parse(source);
}

/** Return true if tree-sitter is available for the given language. */
export async function isTreeSitterAvailable(lang: Language): Promise<boolean> {
  return (await getLanguage(lang)) !== null;
}
