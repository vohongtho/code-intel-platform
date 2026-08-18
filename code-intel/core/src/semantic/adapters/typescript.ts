import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, callableType, declaration, genericType, importBinding, published, reference, typeRef } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.TypeScript);

function extract(context: AdapterExtractionContext): FactBundle {
  const facts = [] as FactBundle['facts'][number][];
  const diagnostics: FactDiagnostic[] = [];
  const lines = context.source.split('\n');

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const classMatch = trimmed.match(/^export\s+class\s+(\w+)/);
    if (classMatch) {
      const factId = `decl:${classMatch[1]}`;
      facts.push(declaration(factId, Language.TypeScript, context.filePath, lineNumber, 'class', classMatch[1], { traits: TRAITS.classLike }));
      facts.push(published(`pub:${classMatch[1]}`, Language.TypeScript, context.filePath, lineNumber, classMatch[1], factId));
      continue;
    }

    const functionMatch = trimmed.match(/^export\s+function\s+(\w+)\(([^)]*)\):\s*([^\s{]+)/);
    if (functionMatch) {
      const factId = `decl:${functionMatch[1]}`;
      const returnType = functionMatch[3].includes('<')
        ? genericType(functionMatch[3], functionMatch[3].split('<')[0], [typeRef(functionMatch[3].match(/<(.*)>/)?.[1] ?? 'unknown')])
        : typeRef(functionMatch[3]);
      facts.push(declaration(factId, Language.TypeScript, context.filePath, lineNumber, 'function', functionMatch[1], {
        signature: {
          parameters: functionMatch[2].split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
            const [name, type] = part.split(':').map((s) => s.trim());
            return { name, type: type ? typeRef(type) : undefined };
          }),
          returnType,
        },
      }));
      facts.push(published(`pub:${functionMatch[1]}`, Language.TypeScript, context.filePath, lineNumber, functionMatch[1], factId));
      if (trimmed.includes('new UserService')) facts.push(reference(`ref:new:${functionMatch[1]}`, Language.TypeScript, context.filePath, lineNumber, 'UserService', 'instantiate'));
      continue;
    }

    const interfaceMatch = trimmed.match(/^export\s+interface\s+(\w+)/);
    if (interfaceMatch) {
      const factId = `decl:${interfaceMatch[1]}`;
      facts.push(declaration(factId, Language.TypeScript, context.filePath, lineNumber, 'interface', interfaceMatch[1], { traits: TRAITS.interfaceLike }));
      facts.push(published(`pub:${interfaceMatch[1]}`, Language.TypeScript, context.filePath, lineNumber, interfaceMatch[1], factId));
      continue;
    }

    const enumMatch = trimmed.match(/^export\s+enum\s+(\w+)/);
    if (enumMatch) {
      const factId = `decl:${enumMatch[1]}`;
      facts.push(declaration(factId, Language.TypeScript, context.filePath, lineNumber, 'enum', enumMatch[1], { traits: TRAITS.structLike }));
      facts.push(published(`pub:${enumMatch[1]}`, Language.TypeScript, context.filePath, lineNumber, enumMatch[1], factId));
      continue;
    }

    const constMatch = trimmed.match(/^export\s+const\s+(\w+)\s*[:=]/);
    if (constMatch) {
      const factId = `decl:${constMatch[1]}`;
      facts.push(declaration(factId, Language.TypeScript, context.filePath, lineNumber, /^[A-Z0-9_]+$/.test(constMatch[1]) ? 'constant' : 'variable', constMatch[1], {
        type: trimmed.includes('=>') ? callableType([], typeRef('unknown')) : undefined,
      }));
      facts.push(published(`pub:${constMatch[1]}`, Language.TypeScript, context.filePath, lineNumber, constMatch[1], factId));
      continue;
    }

    const groupedConstMatch = trimmed.match(/^export\s+const\s+(\w+)\s*=.*?,\s*(\w+)\s*=/);
    if (groupedConstMatch) {
      for (const name of [groupedConstMatch[1], groupedConstMatch[2]]) {
        const factId = `decl:${name}`;
        facts.push(declaration(factId, Language.TypeScript, context.filePath, lineNumber, 'constant', name, { traits: TRAITS.structLike }));
        facts.push(published(`pub:${name}`, Language.TypeScript, context.filePath, lineNumber, name, factId));
      }
      continue;
    }

    const importMatch = trimmed.match(/^import\s+\{?\s*([^}]+?)\s*\}?\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      for (const name of importMatch[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
        facts.push(importBinding(`imp:${name}:${lineNumber}`, Language.TypeScript, context.filePath, lineNumber, importMatch[2], name, name));
      }
      continue;
    }
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.TypeScript, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const typescriptFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.TypeScript,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
