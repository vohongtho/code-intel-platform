import { Language } from '../shared/languages.js';
import {
  cQueries,
  cppQueries,
  csharpQueries,
  dartQueries,
  goQueries,
  htmlQueries,
  javaQueries,
  javascriptQueries,
  kotlinQueries,
  phpQueries,
  pythonQueries,
  rubyQueries,
  rustQueries,
  swiftQueries,
  typescriptQueries,
} from '../parsing/queries/index.js';
import type { LanguageCapabilityDescriptor } from './capability-types.js';

const FULL = {
  definitions: 'supported',
  ownership: 'supported',
  imports: 'supported',
  exports: 'supported',
  calls: 'supported',
  references: 'partial',
  heritage: 'supported',
  typeHints: 'supported',
  controlFlow: 'unsupported',
  dataFlow: 'unsupported',
  embeddedLanguages: 'unsupported',
} as const;

const PARTIAL = {
  definitions: 'supported',
  ownership: 'partial',
  imports: 'partial',
  exports: 'partial',
  calls: 'partial',
  references: 'partial',
  heritage: 'partial',
  typeHints: 'partial',
  controlFlow: 'unsupported',
  dataFlow: 'unsupported',
  embeddedLanguages: 'unsupported',
} as const;

const LIGHT = PARTIAL;

const HTML_CAPS = {
  definitions: 'supported',
  ownership: 'supported',
  imports: 'supported',
  exports: 'not-applicable',
  calls: 'not-applicable',
  references: 'supported',
  heritage: 'not-applicable',
  typeHints: 'not-applicable',
  controlFlow: 'not-applicable',
  dataFlow: 'not-applicable',
  embeddedLanguages: 'partial',
} as const;

const DEFAULT_PERF = {
  maxWorkspaceTraversalsPerPass: 4,
  maxPreparedIndexBuildsPerPass: 1,
  scalingBudget: 4,
  depthScalingBudget: 4,
  candidateLookupBudget: 4,
  truncationBudget: 0,
  retainedHeapMiB: 1,
} as const;

function descriptor(descriptor: LanguageCapabilityDescriptor): LanguageCapabilityDescriptor {
  return Object.freeze(descriptor);
}

export const LANGUAGE_CAPABILITY_REGISTRY = [
  descriptor({
    language: Language.TypeScript,
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    grammarArtifact: 'tree-sitter-typescript.wasm',
    devGrammarPackage: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
    queryProvider: () => typescriptQueries,
    adapterId: 'typescript',
    capabilities: FULL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.JavaScript,
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    grammarArtifact: 'tree-sitter-javascript.wasm',
    devGrammarPackage: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
    queryProvider: () => javascriptQueries,
    adapterId: 'javascript',
    capabilities: FULL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Python,
    extensions: ['.py', '.pyi'],
    grammarArtifact: 'tree-sitter-python.wasm',
    devGrammarPackage: 'tree-sitter-python/tree-sitter-python.wasm',
    queryProvider: () => pythonQueries,
    adapterId: 'python',
    capabilities: FULL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Java,
    extensions: ['.java'],
    grammarArtifact: 'tree-sitter-java.wasm',
    devGrammarPackage: 'tree-sitter-java/tree-sitter-java.wasm',
    queryProvider: () => javaQueries,
    adapterId: 'java',
    capabilities: FULL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Go,
    extensions: ['.go'],
    grammarArtifact: 'tree-sitter-go.wasm',
    devGrammarPackage: 'tree-sitter-go/tree-sitter-go.wasm',
    queryProvider: () => goQueries,
    adapterId: 'go',
    capabilities: FULL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.C,
    extensions: ['.c', '.h'],
    grammarArtifact: 'tree-sitter-c.wasm',
    devGrammarPackage: 'tree-sitter-c/tree-sitter-c.wasm',
    queryProvider: () => cQueries,
    adapterId: 'c',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Cpp,
    extensions: ['.cpp', '.cxx', '.cc', '.hpp', '.hxx'],
    grammarArtifact: 'tree-sitter-cpp.wasm',
    devGrammarPackage: 'tree-sitter-cpp/tree-sitter-cpp.wasm',
    queryProvider: () => cppQueries,
    adapterId: 'cpp',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.CSharp,
    extensions: ['.cs'],
    grammarArtifact: 'tree-sitter-c_sharp.wasm',
    devGrammarPackage: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
    queryProvider: () => csharpQueries,
    adapterId: 'csharp',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Rust,
    extensions: ['.rs'],
    grammarArtifact: 'tree-sitter-rust.wasm',
    devGrammarPackage: 'tree-sitter-rust/tree-sitter-rust.wasm',
    queryProvider: () => rustQueries,
    adapterId: 'rust',
    capabilities: FULL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.PHP,
    extensions: ['.php'],
    grammarArtifact: 'tree-sitter-php.wasm',
    devGrammarPackage: 'tree-sitter-php/tree-sitter-php.wasm',
    queryProvider: () => phpQueries,
    adapterId: 'php',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Kotlin,
    extensions: ['.kt', '.kts'],
    grammarArtifact: 'tree-sitter-kotlin.wasm',
    devGrammarPackage: 'tree-sitter-kotlin/tree-sitter-kotlin.wasm',
    queryProvider: () => kotlinQueries,
    adapterId: 'kotlin',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Ruby,
    extensions: ['.rb'],
    grammarArtifact: 'tree-sitter-ruby.wasm',
    devGrammarPackage: 'tree-sitter-ruby/tree-sitter-ruby.wasm',
    queryProvider: () => rubyQueries,
    adapterId: 'ruby',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Swift,
    extensions: ['.swift'],
    grammarArtifact: 'tree-sitter-swift.wasm',
    devGrammarPackage: 'tree-sitter-swift/tree-sitter-swift.wasm',
    queryProvider: () => swiftQueries,
    adapterId: 'swift',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.Dart,
    extensions: ['.dart'],
    grammarArtifact: 'tree-sitter-dart.wasm',
    devGrammarPackage: 'tree-sitter-dart/tree-sitter-dart.wasm',
    queryProvider: () => dartQueries,
    adapterId: 'dart',
    capabilities: PARTIAL,
    resolutionPerformance: DEFAULT_PERF,
  }),
  descriptor({
    language: Language.HTML,
    extensions: ['.html'],
    grammarArtifact: 'tree-sitter-html.wasm',
    devGrammarPackage: 'tree-sitter-html/tree-sitter-html.wasm',
    queryProvider: () => htmlQueries,
    adapterId: 'html',
    capabilities: HTML_CAPS,
    resolutionPerformance: DEFAULT_PERF,
  }),
] as const satisfies readonly LanguageCapabilityDescriptor[];

const REGISTRY_BY_LANGUAGE = new Map(LANGUAGE_CAPABILITY_REGISTRY.map((entry) => [entry.language, entry]));
const REGISTRY_BY_EXTENSION = new Map(
  LANGUAGE_CAPABILITY_REGISTRY.flatMap((entry) => entry.extensions.map((ext) => [ext, entry] as const)),
);

export function getLanguageCapabilityDescriptors(): readonly LanguageCapabilityDescriptor[] {
  return LANGUAGE_CAPABILITY_REGISTRY;
}

export function getLanguageCapabilityDescriptor(language: Language): LanguageCapabilityDescriptor {
  const found = REGISTRY_BY_LANGUAGE.get(language);
  if (!found) throw new Error(`Missing language capability descriptor for ${language}`);
  return found;
}

export function findLanguageCapabilityByExtension(extension: string): LanguageCapabilityDescriptor | null {
  return REGISTRY_BY_EXTENSION.get(extension) ?? null;
}

export function getLanguageQuery(language: Language): string | null {
  return getLanguageCapabilityDescriptor(language).queryProvider?.() ?? null;
}

export function validateLanguageCapabilityRegistry(
  descriptors: readonly LanguageCapabilityDescriptor[] = LANGUAGE_CAPABILITY_REGISTRY,
): void {
  const seenLanguages = new Set<Language>();
  const seenExtensions = new Set<string>();

  for (const descriptor of descriptors) {
    if (seenLanguages.has(descriptor.language)) {
      throw new Error(`Duplicate language descriptor: ${descriptor.language}`);
    }
    seenLanguages.add(descriptor.language);

    if (descriptor.extensions.length === 0) {
      throw new Error(`Descriptor ${descriptor.language} has no extensions`);
    }

    for (const extension of descriptor.extensions) {
      if (!extension.startsWith('.')) {
        throw new Error(`Descriptor ${descriptor.language} has invalid extension: ${extension}`);
      }
      if (seenExtensions.has(extension)) {
        throw new Error(`Duplicate extension mapping: ${extension}`);
      }
      seenExtensions.add(extension);
    }
  }

  const languages = Object.values(Language);
  if (descriptors.length !== languages.length) {
    throw new Error(`Expected ${languages.length} language descriptors, received ${descriptors.length}`);
  }

  for (const language of languages) {
    if (!seenLanguages.has(language)) {
      throw new Error(`Missing language descriptor: ${language}`);
    }
  }
}

validateLanguageCapabilityRegistry();
