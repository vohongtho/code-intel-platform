import { Language } from '../shared/index.js';
import type { LanguageModule } from './types.js';
import { typescriptModule, javascriptModule } from './modules/typescript.js';
import { pythonModule } from './modules/python.js';
import { javaModule } from './modules/java.js';
import { goModule } from './modules/go.js';
import { cModule } from './modules/c.js';
import { cppModule } from './modules/cpp.js';
import { csharpModule } from './modules/csharp.js';
import { rustModule } from './modules/rust.js';
import { phpModule } from './modules/php.js';
import { kotlinModule } from './modules/kotlin.js';
import { rubyModule } from './modules/ruby.js';
import { swiftModule } from './modules/swift.js';
import { dartModule } from './modules/dart.js';

const MODULES: Record<Language, LanguageModule> = {
  [Language.TypeScript]: typescriptModule,
  [Language.JavaScript]: javascriptModule,
  [Language.Python]: pythonModule,
  [Language.Java]: javaModule,
  [Language.Go]: goModule,
  [Language.C]: cModule,
  [Language.Cpp]: cppModule,
  [Language.CSharp]: csharpModule,
  [Language.Rust]: rustModule,
  [Language.PHP]: phpModule,
  [Language.Kotlin]: kotlinModule,
  [Language.Ruby]: rubyModule,
  [Language.Swift]: swiftModule,
  [Language.Dart]: dartModule,
};

export function getLanguageModule(lang: Language): LanguageModule {
  return MODULES[lang];
}

export function getAllLanguageModules(): LanguageModule[] {
  return Object.values(MODULES);
}
