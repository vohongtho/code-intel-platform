import { Language } from '../../shared/languages.js';
import type { LanguageFactAdapter } from './adapter.js';
import { createCapabilityAdapter } from './factory.js';
import { cFactAdapter } from './c.js';
import { cppFactAdapter } from './cpp.js';
import { csharpFactAdapter } from './csharp.js';
import { dartFactAdapter } from './dart.js';
import { goFactAdapter } from './go.js';
import { htmlFactAdapter } from './html.js';
import { javaFactAdapter } from './java.js';
import { javascriptFactAdapter } from './javascript.js';
import { kotlinFactAdapter } from './kotlin.js';
import { phpFactAdapter } from './php.js';
import { pythonFactAdapter } from './python.js';
import { rubyFactAdapter } from './ruby.js';
import { rustFactAdapter } from './rust.js';
import { swiftFactAdapter } from './swift.js';
import { typescriptFactAdapter } from './typescript.js';

export const LANGUAGE_FACT_ADAPTERS: Record<Language, LanguageFactAdapter> = {
  [Language.TypeScript]: typescriptFactAdapter,
  [Language.JavaScript]: javascriptFactAdapter,
  [Language.Python]: pythonFactAdapter,
  [Language.Java]: javaFactAdapter,
  [Language.Go]: goFactAdapter,
  [Language.C]: cFactAdapter,
  [Language.Cpp]: cppFactAdapter,
  [Language.CSharp]: csharpFactAdapter,
  [Language.Rust]: rustFactAdapter,
  [Language.PHP]: phpFactAdapter,
  [Language.Kotlin]: kotlinFactAdapter,
  [Language.Ruby]: rubyFactAdapter,
  [Language.Swift]: swiftFactAdapter,
  [Language.Dart]: dartFactAdapter,
  [Language.HTML]: htmlFactAdapter,
};

export function getLanguageFactAdapter(language: Language): LanguageFactAdapter {
  return LANGUAGE_FACT_ADAPTERS[language] ?? createCapabilityAdapter(language);
}
