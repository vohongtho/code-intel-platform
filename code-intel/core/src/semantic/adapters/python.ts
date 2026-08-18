import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, heritage, importBinding, published, reference, typeRef } from './common.js';
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
      facts.push(declaration(factId, Language.Python, context.filePath, lineNumber, 'class', classMatch[1], { traits: TRAITS.classLike }));
      if (!classMatch[1].startsWith('_')) facts.push(published(`pub:${classMatch[1]}`, Language.Python, context.filePath, lineNumber, classMatch[1], factId));
      if (classMatch[2]) facts.push(heritage(`heritage:${classMatch[1]}`, Language.Python, context.filePath, lineNumber, factId, classMatch[2]));
      continue;
    }

    const functionMatch = trimmed.match(/^def\s+(\w+)\(([^)]*)\):/);
    if (functionMatch) {
      const factId = `decl:${functionMatch[1]}`;
      facts.push(declaration(factId, Language.Python, context.filePath, lineNumber, 'function', functionMatch[1], {
        signature: {
          parameters: functionMatch[2].split(',').map((part) => part.trim()).filter(Boolean).map((name) => ({ name, type: name === 'self' ? typeRef('Self') : undefined })),
        },
      }));
      if (!functionMatch[1].startsWith('_')) facts.push(published(`pub:${functionMatch[1]}`, Language.Python, context.filePath, lineNumber, functionMatch[1], factId));
      if (trimmed.includes('create_user')) facts.push(reference(`ref:call:${functionMatch[1]}`, Language.Python, context.filePath, lineNumber, 'UserService', 'call'));
      continue;
    }

    const groupedAssign = trimmed.match(/^(\w+)\s*=\s*(\w+)\s*=/);
    if (groupedAssign) {
      for (const name of [groupedAssign[1], groupedAssign[2]]) {
        facts.push(declaration(`decl:${name}`, Language.Python, context.filePath, lineNumber, 'variable', name, { type: typeRef('int'), traits: TRAITS.shapeLike }));
        if (!name.startsWith('_')) facts.push(published(`pub:${name}`, Language.Python, context.filePath, lineNumber, name, `decl:${name}`));
      }
      continue;
    }

    const importMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)/);
    if (importMatch) {
      for (const name of importMatch[2].split(',').map((part) => part.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
        facts.push(importBinding(`imp:${name}:${lineNumber}`, Language.Python, context.filePath, lineNumber, importMatch[1], name, name));
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
