import { Language } from '../shared/index.js';
import Parser from 'web-tree-sitter';

let initialized = false;
const parserCache = new Map<Language, Parser>();
const languageCache = new Map<Language, Parser.Language>();

const GRAMMAR_WASM_MAP: Partial<Record<Language, string>> = {
  // WASM grammar files to be downloaded/provided per language
  // For now, the parser manager provides a placeholder
};

export async function initParser(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

export async function getParser(lang: Language): Promise<Parser> {
  await initParser();
  let parser = parserCache.get(lang);
  if (parser) return parser;

  parser = new Parser();
  parserCache.set(lang, parser);
  return parser;
}

export async function getLanguage(lang: Language): Promise<Parser.Language | null> {
  const cached = languageCache.get(lang);
  if (cached) return cached;

  const wasmPath = GRAMMAR_WASM_MAP[lang];
  if (!wasmPath) return null;

  try {
    const language = await Parser.Language.load(wasmPath);
    languageCache.set(lang, language);
    return language;
  } catch {
    return null;
  }
}

export async function parseSource(
  lang: Language,
  source: string,
): Promise<Parser.Tree | null> {
  const parser = await getParser(lang);
  const language = await getLanguage(lang);
  if (!language) return null;
  parser.setLanguage(language);
  return parser.parse(source);
}
