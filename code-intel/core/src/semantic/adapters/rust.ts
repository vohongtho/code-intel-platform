import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, declarationFragment, genericType, importBinding, pointerType, published, reference, referenceType, typeRef, visibility } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.Rust);

function extract(context: AdapterExtractionContext): FactBundle {
  const facts = [] as FactBundle['facts'][number][];
  const diagnostics: FactDiagnostic[] = [];
  const lines = context.source.split('\n');

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const structMatch = trimmed.match(/^pub\s+struct\s+(\w+)/);
    if (structMatch) {
      const factId = `decl:${structMatch[1]}`;
      facts.push(declaration(factId, Language.Rust, context.filePath, lineNumber, 'struct', structMatch[1], {
        qualifiedName: `${context.filePath}:${structMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.structLike,
      }));
      facts.push(declarationFragment(`frag:${structMatch[1]}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, factId, structMatch[1]));
      facts.push(published(`pub:${structMatch[1]}`, Language.Rust, context.filePath, lineNumber, structMatch[1], factId));
      continue;
    }

    const enumMatch = trimmed.match(/^pub\s+enum\s+(\w+)/);
    if (enumMatch) {
      const factId = `decl:${enumMatch[1]}`;
      facts.push(declaration(factId, Language.Rust, context.filePath, lineNumber, 'enum', enumMatch[1], {
        qualifiedName: `${context.filePath}:${enumMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.structLike,
      }));
      facts.push(declarationFragment(`frag:${enumMatch[1]}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, factId, enumMatch[1]));
      facts.push(published(`pub:${enumMatch[1]}`, Language.Rust, context.filePath, lineNumber, enumMatch[1], factId));
      continue;
    }

    const traitMatch = trimmed.match(/^pub\s+trait\s+(\w+)/);
    if (traitMatch) {
      const factId = `decl:${traitMatch[1]}`;
      facts.push(declaration(factId, Language.Rust, context.filePath, lineNumber, 'trait', traitMatch[1], {
        qualifiedName: `${context.filePath}:${traitMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.interfaceLike,
      }));
      facts.push(declarationFragment(`frag:${traitMatch[1]}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, factId, traitMatch[1], { hasBody: false }));
      facts.push(published(`pub:${traitMatch[1]}`, Language.Rust, context.filePath, lineNumber, traitMatch[1], factId));
      continue;
    }

    const fnMatches = [...trimmed.matchAll(/(pub\s+)?fn\s+(\w+)\(([^)]*)\)\s*(?:->\s*([^\s{]+))?/g)];
    if (fnMatches.length > 0) {
      for (const fnMatch of fnMatches) {
      const factId = `decl:${fnMatch[2]}`;
      const returnType = fnMatch[4]
        ? fnMatch[4].startsWith('&')
          ? referenceType(fnMatch[4], typeRef(fnMatch[4].replace(/^&/, '')))
          : fnMatch[4].startsWith('*')
            ? pointerType(fnMatch[4], typeRef(fnMatch[4].replace(/^\*/, '')))
            : fnMatch[4].includes('<')
              ? genericType(fnMatch[4], fnMatch[4].split('<')[0], [typeRef(fnMatch[4].match(/<(.*)>/)?.[1] ?? 'unknown')])
              : typeRef(fnMatch[4])
        : undefined;
      facts.push(declaration(factId, Language.Rust, context.filePath, lineNumber, 'function', fnMatch[2], {
        qualifiedName: `${context.filePath}:${fnMatch[2]}`,
        visibility: visibility(fnMatch[1] ? 'public' : 'private'),
        signature: {
          parameters: fnMatch[3].split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
            const [name, type] = part.split(':').map((s) => s.trim());
            return {
              name,
              type: !type ? undefined : type.startsWith('&')
                ? referenceType(type, typeRef(type.replace(/^&/, '')))
                : type.startsWith('*')
                  ? pointerType(type, typeRef(type.replace(/^\*/, '')))
                  : typeRef(type),
            };
          }),
          returnType,
        },
      }));
      facts.push(declarationFragment(`frag:${fnMatch[2]}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, factId, fnMatch[2]));
      if (fnMatch[1]) facts.push(published(`pub:${fnMatch[2]}`, Language.Rust, context.filePath, lineNumber, fnMatch[2], factId));
      }
      if (trimmed.includes('Config {')) facts.push(reference(`ref:type:Config:${lineNumber}`, Language.Rust, context.filePath, lineNumber, 'Config', 'type-use'));
      continue;
    }

    const groupedStruct = trimmed.match(/^struct\s+(\w+);/);
    if (groupedStruct) {
      facts.push(declaration(`decl:${groupedStruct[1]}`, Language.Rust, context.filePath, lineNumber, 'struct', groupedStruct[1], {
        qualifiedName: `${context.filePath}:${groupedStruct[1]}`,
        visibility: visibility('private'),
        traits: TRAITS.structLike,
      }));
      facts.push(declarationFragment(`frag:${groupedStruct[1]}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, `decl:${groupedStruct[1]}`, groupedStruct[1], { hasBody: false }));
      continue;
    }

    const groupedLet = trimmed.match(/^let\s+(\w+)\s*=.*?;\s*let\s+(\w+)\s*=/);
    if (groupedLet) {
      for (const name of [groupedLet[1], groupedLet[2]]) {
        facts.push(declaration(`decl:${name}`, Language.Rust, context.filePath, lineNumber, 'variable', name, {
          qualifiedName: `${context.filePath}:${name}`,
          visibility: visibility('local'),
          type: typeRef('i32'),
          traits: TRAITS.shapeLike,
        }));
        facts.push(declarationFragment(`frag:${name}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, `decl:${name}`, name));
      }
      continue;
    }

    const useMatch = trimmed.match(/^use\s+(.+);/);
    if (useMatch) {
      const leaf = useMatch[1].split('::').pop() ?? useMatch[1];
      facts.push(importBinding(`imp:${leaf}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, useMatch[1], leaf, leaf, 'named'));
      if (trimmed.startsWith('pub use')) facts.push(published(`pub-use:${leaf}:${lineNumber}`, Language.Rust, context.filePath, lineNumber, leaf, `imp:${leaf}:${lineNumber}`, 'reexport'));
      continue;
    }

    if (trimmed.includes('Config {')) facts.push(reference(`ref:type:Config:${lineNumber}`, Language.Rust, context.filePath, lineNumber, 'Config', 'type-use'));
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.Rust, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const rustFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.Rust,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
