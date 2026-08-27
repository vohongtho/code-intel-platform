import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, declarationFragment, published, visibility } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.HTML);

function extract(context: AdapterExtractionContext): FactBundle {
  const facts = [] as FactBundle['facts'][number][];
  const diagnostics: FactDiagnostic[] = [];
  const lines = context.source.split('\n');

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const idMatch = line.match(/id="([^"]+)"/);
    if (idMatch) {
      const factId = `decl:${idMatch[1]}`;
      facts.push(declaration(factId, Language.HTML, context.filePath, lineNumber, 'property', idMatch[1], {
        qualifiedName: `${context.filePath}:${idMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:${idMatch[1]}:${lineNumber}`, Language.HTML, context.filePath, lineNumber, factId, idMatch[1], { hasBody: false }));
      facts.push(published(`pub:${idMatch[1]}`, Language.HTML, context.filePath, lineNumber, idMatch[1], factId));
    }

    const classMatch = line.match(/class="([^"]+)"/);
    if (classMatch) {
      for (const token of classMatch[1].split(/\s+/).filter(Boolean)) {
        const factId = `decl:${token}`;
        facts.push(declaration(factId, Language.HTML, context.filePath, lineNumber, 'property', token, {
          qualifiedName: `${context.filePath}:${token}`,
          visibility: visibility('public'),
          traits: TRAITS.shapeLike,
        }));
        facts.push(declarationFragment(`frag:${token}:${lineNumber}`, Language.HTML, context.filePath, lineNumber, factId, token, { hasBody: false }));
        facts.push(published(`pub:${token}`, Language.HTML, context.filePath, lineNumber, token, factId));
      }
    }

    const hrefMatch = line.match(/<(a|link)\b[^>]*(href)="([^"]+)"/);
    if (hrefMatch) {
      const kind = hrefMatch[1] === 'link' ? 'module' : 'variable';
      const factId = `decl:${hrefMatch[3]}`;
      facts.push(declaration(factId, Language.HTML, context.filePath, lineNumber, kind, hrefMatch[3], {
        qualifiedName: `${context.filePath}:${hrefMatch[3]}`,
        visibility: visibility('public'),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:${hrefMatch[3]}:${lineNumber}`, Language.HTML, context.filePath, lineNumber, factId, hrefMatch[3], { hasBody: false }));
      facts.push(published(`pub:${hrefMatch[3]}`, Language.HTML, context.filePath, lineNumber, hrefMatch[3], factId));
    }

    const srcMatch = line.match(/<script\b[^>]*src="([^"]+)"/);
    if (srcMatch) {
      const factId = `decl:${srcMatch[1]}`;
      facts.push(declaration(factId, Language.HTML, context.filePath, lineNumber, 'module', srcMatch[1], {
        qualifiedName: `${context.filePath}:${srcMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:${srcMatch[1]}:${lineNumber}`, Language.HTML, context.filePath, lineNumber, factId, srcMatch[1], { hasBody: false }));
      facts.push(published(`pub:${srcMatch[1]}`, Language.HTML, context.filePath, lineNumber, srcMatch[1], factId));
    }

    const formMatch = line.match(/<form\b[^>]*action="([^"]+)"/);
    if (formMatch) {
      const factId = `decl:${formMatch[1]}`;
      facts.push(declaration(factId, Language.HTML, context.filePath, lineNumber, 'variable', formMatch[1], {
        qualifiedName: `${context.filePath}:${formMatch[1]}`,
        visibility: visibility('public'),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:${formMatch[1]}:${lineNumber}`, Language.HTML, context.filePath, lineNumber, factId, formMatch[1], { hasBody: false }));
      facts.push(published(`pub:${formMatch[1]}`, Language.HTML, context.filePath, lineNumber, formMatch[1], factId));
    }

    const embeddedMatch = line.match(/<script>(.+)<\/script>/);
    if (embeddedMatch) {
      const factId = `decl:${embeddedMatch[1]}`;
      facts.push(declaration(factId, Language.HTML, context.filePath, lineNumber, 'variable', embeddedMatch[1], {
        qualifiedName: `${context.filePath}:${embeddedMatch[1]}`,
        visibility: visibility('local'),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:${embeddedMatch[1]}:${lineNumber}`, Language.HTML, context.filePath, lineNumber, factId, embeddedMatch[1], { hasBody: true }));
      facts.push(published(`pub:${embeddedMatch[1]}`, Language.HTML, context.filePath, lineNumber, embeddedMatch[1], factId));
    }
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.HTML, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const htmlFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.HTML,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
