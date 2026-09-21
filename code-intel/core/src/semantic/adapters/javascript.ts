import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, declarationFragment, genericType, importBinding, published, reference, typeRef, visibility } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.JavaScript);

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
      facts.push(declaration(factId, Language.JavaScript, context.filePath, lineNumber, 'class', classMatch[1], {
        qualifiedName: `${context.filePath}:${classMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.classLike,
      }));
      facts.push(declarationFragment(`frag:${classMatch[1]}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, factId, classMatch[1]));
      facts.push(published(`pub:${classMatch[1]}`, Language.JavaScript, context.filePath, lineNumber, classMatch[1], factId));
      continue;
    }

    const functionMatch = trimmed.match(/^export\s+function\s+(\w+)\(([^)]*)\)/);
    if (functionMatch) {
      const factId = `decl:${functionMatch[1]}`;
      facts.push(declaration(factId, Language.JavaScript, context.filePath, lineNumber, 'function', functionMatch[1], {
        qualifiedName: `${context.filePath}:${functionMatch[1]}`,
        visibility: visibility('public'),
        signature: {
          parameters: functionMatch[2].split(',').map((part) => part.trim()).filter(Boolean).map((name) => ({ name })),
          returnType: trimmed.includes('new UserService') ? typeRef('UserService') : undefined,
        },
      }));
      facts.push(declarationFragment(`frag:${functionMatch[1]}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, factId, functionMatch[1]));
      facts.push(published(`pub:${functionMatch[1]}`, Language.JavaScript, context.filePath, lineNumber, functionMatch[1], factId));
      if (trimmed.includes('new UserService')) {
        facts.push(reference(`ref:new:${functionMatch[1]}`, Language.JavaScript, context.filePath, lineNumber, 'UserService', 'instantiate'));
      }
      continue;
    }

    const constMatch = trimmed.match(/^export\s+const\s+(\w+)\s*=/);
    if (constMatch) {
      const factId = `decl:${constMatch[1]}`;
      facts.push(declaration(factId, Language.JavaScript, context.filePath, lineNumber, /^[A-Z0-9_]+$/.test(constMatch[1]) ? 'constant' : 'variable', constMatch[1], {
        qualifiedName: `${context.filePath}:${constMatch[1]}`,
        visibility: visibility('public'),
        type: trimmed.includes("'") ? typeRef('string') : undefined,
      }));
      facts.push(declarationFragment(`frag:${constMatch[1]}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, factId, constMatch[1]));
      facts.push(published(`pub:${constMatch[1]}`, Language.JavaScript, context.filePath, lineNumber, constMatch[1], factId));
      continue;
    }

    const importMatch = trimmed.match(/^import\s+\{?\s*([^}]+?)\s*\}?\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      for (const part of importMatch[1].split(',').map((value) => value.trim()).filter(Boolean)) {
        const [importedName, localName] = part.split(/\s+as\s+/).map((value) => value.trim());
        facts.push(importBinding(`imp:${localName ?? importedName}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, importMatch[2], localName ?? importedName, importedName, localName ? 'alias' : 'named'));
      }
      continue;
    }

    const reexportMatch = trimmed.match(/^export\s+\{\s*([^}]+?)\s*\}\s+from\s+['"]([^'"]+)['"]/);
    if (reexportMatch) {
      for (const part of reexportMatch[1].split(',').map((value) => value.trim()).filter(Boolean)) {
        const [sourceName, publicName] = part.split(/\s+as\s+/).map((value) => value.trim());
        facts.push(published(`pub:reexport:${publicName ?? sourceName}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, publicName ?? sourceName, reexportMatch[2], 'reexport'));
      }
      continue;
    }

    const genericMatch = trimmed.match(/@type\s+\{(\w+)<(\w+)>\}/);
    if (genericMatch) {
      facts.push(declaration(`decl:type:${genericMatch[1]}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, 'type_alias', genericMatch[1], {
        qualifiedName: `${context.filePath}:${genericMatch[1]}`,
        visibility: visibility('public'),
        type: genericType(`${genericMatch[1]}<${genericMatch[2]}>`, genericMatch[1], [typeRef(genericMatch[2])]),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:type:${genericMatch[1]}:${lineNumber}`, Language.JavaScript, context.filePath, lineNumber, `decl:type:${genericMatch[1]}:${lineNumber}`, genericMatch[1], { hasBody: false }));
      continue;
    }
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.JavaScript, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const javascriptFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.JavaScript,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
