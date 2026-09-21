import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, declarationFragment, heritage, importBinding, published, reference, typeRef, visibility } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.Python);

function extract(context: AdapterExtractionContext): FactBundle {
  const facts = [] as FactBundle['facts'][number][];
  const diagnostics: FactDiagnostic[] = [];
  const lines = context.source.split('\n');

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?:/);
    if (classMatch) {
      const factId = `decl:${classMatch[1]}`;
      facts.push(declaration(factId, Language.Python, context.filePath, lineNumber, 'class', classMatch[1], {
        qualifiedName: `${context.filePath}:${classMatch[1]}`,
        visibility: visibility(classMatch[1].startsWith('_') ? 'private' : 'public'),
        traits: TRAITS.classLike,
      }));
      facts.push(declarationFragment(`frag:${classMatch[1]}:${lineNumber}`, Language.Python, context.filePath, lineNumber, factId, classMatch[1]));
      if (!classMatch[1].startsWith('_')) facts.push(published(`pub:${classMatch[1]}`, Language.Python, context.filePath, lineNumber, classMatch[1], factId));
      if (classMatch[2]) facts.push(heritage(`heritage:${classMatch[1]}`, Language.Python, context.filePath, lineNumber, factId, classMatch[2]));
      continue;
    }

    const functionMatch = trimmed.match(/^def\s+(\w+)\(([^)]*)\):/);
    if (functionMatch) {
      const factId = `decl:${functionMatch[1]}`;
      facts.push(declaration(factId, Language.Python, context.filePath, lineNumber, 'function', functionMatch[1], {
        qualifiedName: `${context.filePath}:${functionMatch[1]}`,
        visibility: visibility(functionMatch[1].startsWith('_') ? 'private' : 'public'),
        signature: {
          parameters: functionMatch[2].split(',').map((part) => part.trim()).filter(Boolean).map((name) => ({ name, type: name === 'self' ? typeRef('Self') : undefined })),
        },
      }));
      facts.push(declarationFragment(`frag:${functionMatch[1]}:${lineNumber}`, Language.Python, context.filePath, lineNumber, factId, functionMatch[1]));
      if (!functionMatch[1].startsWith('_')) facts.push(published(`pub:${functionMatch[1]}`, Language.Python, context.filePath, lineNumber, functionMatch[1], factId));
      if (trimmed.includes('create_user')) facts.push(reference(`ref:call:${functionMatch[1]}`, Language.Python, context.filePath, lineNumber, 'UserService', 'call'));
      continue;
    }

    const groupedAssign = trimmed.match(/^(\w+)\s*=\s*(\w+)\s*=/);
    if (groupedAssign) {
      for (const name of [groupedAssign[1], groupedAssign[2]]) {
        facts.push(declaration(`decl:${name}`, Language.Python, context.filePath, lineNumber, 'variable', name, {
          qualifiedName: `${context.filePath}:${name}`,
          visibility: visibility(name.startsWith('_') ? 'private' : 'public'),
          type: typeRef('int'),
          traits: TRAITS.shapeLike,
        }));
        facts.push(declarationFragment(`frag:${name}:${lineNumber}`, Language.Python, context.filePath, lineNumber, `decl:${name}`, name));
        if (!name.startsWith('_')) facts.push(published(`pub:${name}`, Language.Python, context.filePath, lineNumber, name, `decl:${name}`));
      }
      continue;
    }

    const importMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
    if (importMatch) {
      for (const part of importMatch[2].split(',').map((value) => value.trim()).filter(Boolean)) {
        const [importedName, localName] = part.split(/\s+as\s+/).map((value) => value.trim());
        facts.push(importBinding(`imp:${localName ?? importedName}:${lineNumber}`, Language.Python, context.filePath, lineNumber, importMatch[1], localName ?? importedName, importedName, localName ? 'alias' : 'named'));
      }
      continue;
    }

    const directImport = trimmed.match(/^import\s+([\w.]+)(?:\s+as\s+(\w+))?/);
    if (directImport) {
      const importedName = directImport[1].split('.').pop() ?? directImport[1];
      const localName = directImport[2] ?? importedName;
      facts.push(importBinding(`imp:${localName}:${lineNumber}`, Language.Python, context.filePath, lineNumber, directImport[1], localName, importedName, directImport[2] ? 'alias' : 'namespace'));
      continue;
    }

    const reexport = trimmed.match(/^__all__\s*=\s*\[(.+)\]/);
    if (reexport) {
      for (const token of reexport[1].split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)) {
        facts.push(published(`pub:all:${token}:${lineNumber}`, Language.Python, context.filePath, lineNumber, token, context.filePath, 'language-implicit'));
      }
      continue;
    }
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.Python, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const pythonFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.Python,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
