import { Language } from './languages.js';

const EXTENSION_MAP: Record<string, Language> = {
  '.ts': Language.TypeScript,
  '.tsx': Language.TypeScript,
  '.mts': Language.TypeScript,
  '.cts': Language.TypeScript,
  '.js': Language.JavaScript,
  '.jsx': Language.JavaScript,
  '.mjs': Language.JavaScript,
  '.cjs': Language.JavaScript,
  '.py': Language.Python,
  '.pyi': Language.Python,
  '.java': Language.Java,
  '.go': Language.Go,
  '.c': Language.C,
  '.h': Language.C,
  '.cpp': Language.Cpp,
  '.cxx': Language.Cpp,
  '.cc': Language.Cpp,
  '.hpp': Language.Cpp,
  '.hxx': Language.Cpp,
  '.cs': Language.CSharp,
  '.rs': Language.Rust,
  '.php': Language.PHP,
  '.kt': Language.Kotlin,
  '.kts': Language.Kotlin,
  '.rb': Language.Ruby,
  '.swift': Language.Swift,
  '.dart': Language.Dart,
};

export function detectLanguage(filePath: string): Language | null {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return EXTENSION_MAP[ext] ?? null;
}

export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP);
}
