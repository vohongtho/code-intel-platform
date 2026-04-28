import { createRequire } from 'node:module';
import { Language } from '../shared/index.js';
import { Parser, Language as TSLanguage } from 'web-tree-sitter';

const _require = createRequire(import.meta.url);

/**
 * Resolve the absolute path to a language WASM file.
 * Each grammar is shipped by its own `tree-sitter-<lang>` npm package (dylink.0 format,
 * compatible with web-tree-sitter 0.26.x).
 * Returns null when no compatible WASM is bundled.
 */
function wasmPath(lang: Language): string | null {
  const WASM_PACKAGE_MAP: Partial<Record<Language, string>> = {
    [Language.TypeScript]: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
    [Language.JavaScript]: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    [Language.Python]:     'tree-sitter-python/tree-sitter-python.wasm',
    [Language.Java]:       'tree-sitter-java/tree-sitter-java.wasm',
    [Language.Go]:         'tree-sitter-go/tree-sitter-go.wasm',
    [Language.C]:          'tree-sitter-c/tree-sitter-c.wasm',
    [Language.Cpp]:        'tree-sitter-cpp/tree-sitter-cpp.wasm',
    [Language.CSharp]:     'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
    [Language.Rust]:       'tree-sitter-rust/tree-sitter-rust.wasm',
    [Language.PHP]:        'tree-sitter-php/tree-sitter-php.wasm',
    [Language.Ruby]:       'tree-sitter-ruby/tree-sitter-ruby.wasm',
    // Swift, Kotlin, Dart: no compatible WASM available — regex fallback used
  };

  const relative = WASM_PACKAGE_MAP[lang];
  if (!relative) return null;
  try {
    return _require.resolve(relative);
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
