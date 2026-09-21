import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, declarationFragment, heritage, published, typeRef, visibility } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.CSharp);

function visOf(prefix: string | undefined) {
  return visibility((prefix as 'public' | 'private' | 'protected' | 'internal' | undefined) ?? 'internal');
}

function paramsOf(value: string) {
  return value.split(',').map((part) => part.trim()).filter(Boolean).map((part, i) => {
    const tokens = part.split(/\s+/).filter(Boolean);
    return {
      name: tokens.at(-1) || `arg${i}`,
      type: tokens.length > 1 ? typeRef(tokens.slice(0, -1).join(' ')) : undefined,
    };
  });
}

function extract(context: AdapterExtractionContext): FactBundle {
  const facts = [] as FactBundle['facts'][number][];
  const diagnostics: FactDiagnostic[] = [];
  const lines = context.source.split('\n');

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const access = /^(public|private|protected|internal)\b/.exec(trimmed)?.[1];

    const classLike = trimmed.match(/^(public|private|protected|internal)?\s*(partial\s+)?(class|interface|struct|enum|record)\s+(\w+)(?:\s*:\s*([^\{]+))?/);
    if (classLike) {
      const [, vis, partial, rawKind, name, heritageText] = classLike;
      const kind = rawKind === 'record' ? 'class' : rawKind;
      const factId = `decl:${name}:${lineNumber}`;
      facts.push(declaration(factId, Language.CSharp, context.filePath, lineNumber, kind, name, {
        qualifiedName: `${context.filePath}:${name}`,
        visibility: visOf(vis),
        traits: rawKind === 'interface' ? TRAITS.interfaceLike : rawKind === 'struct' ? TRAITS.structLike : TRAITS.classLike,
      }));
      facts.push(declarationFragment(`frag:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, factId, name, { partial: Boolean(partial), hasBody: trimmed.includes('{') }));
      if (vis === 'public') facts.push(published(`pub:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, name, factId));
      if (heritageText) {
        for (const target of heritageText.split(',').map((part) => part.trim()).filter(Boolean)) {
          facts.push(heritage(`heritage:${name}:${target}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, factId, target, rawKind === 'interface' ? 'extends' : 'implements'));
        }
      }
      continue;
    }

    const delegateMatch = trimmed.match(/^(public|private|protected|internal)?\s*delegate\s+([\w<>]+)\s+(\w+)\s*\(([^)]*)\)/);
    if (delegateMatch) {
      const [, vis, returnType, name, params] = delegateMatch;
      const factId = `decl:${name}:${lineNumber}`;
      facts.push(declaration(factId, Language.CSharp, context.filePath, lineNumber, 'type_alias', name, {
        qualifiedName: `${context.filePath}:${name}`,
        visibility: visOf(vis),
        type: typeRef(returnType),
        traits: TRAITS.shapeLike,
        signature: { parameters: paramsOf(params), returnType: typeRef(returnType) },
      }));
      facts.push(declarationFragment(`frag:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, factId, name, { hasBody: false }));
      if (vis === 'public') facts.push(published(`pub:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, name, factId));
      continue;
    }

    const eventMatch = trimmed.match(/^(public|private|protected|internal)?\s*event\s+([\w<>]+)\s+(\w+)/);
    if (eventMatch) {
      const [, vis, eventType, name] = eventMatch;
      const factId = `decl:${name}:${lineNumber}`;
      facts.push(declaration(factId, Language.CSharp, context.filePath, lineNumber, 'property', name, {
        qualifiedName: `${context.filePath}:${name}`,
        visibility: visOf(vis),
        type: typeRef(eventType),
        traits: TRAITS.shapeLike,
      }));
      facts.push(declarationFragment(`frag:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, factId, name, { hasBody: false }));
      continue;
    }

    const extensionMatch = trimmed.match(/^(public|private|protected|internal)?\s*(static\s+)?([\w<>]+)\s+(\w+)\s*\(([^)]*)\)/);
    if (extensionMatch && !trimmed.includes('class ') && !trimmed.includes('interface ') && !trimmed.includes('record ')) {
      const [, vis, maybeStatic, returnType, name, params] = extensionMatch;
      const factId = `decl:${name}:${lineNumber}`;
      const parsedParams = paramsOf(params);
      const firstParam = params.split(',')[0]?.trim();
      const isExtension = Boolean(maybeStatic && firstParam?.startsWith('this '));
      facts.push(declaration(factId, Language.CSharp, context.filePath, lineNumber, 'function', name, {
        qualifiedName: `${context.filePath}:${name}${isExtension ? ':extension' : ''}`,
        visibility: visOf(vis),
        type: isExtension && firstParam ? typeRef(firstParam.replace(/^this\s+/, '').split(/\s+/).slice(0, -1).join(' ')) : undefined,
        signature: { parameters: parsedParams, returnType: typeRef(returnType) },
      }));
      facts.push(declarationFragment(`frag:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, factId, name, { hasBody: /\{|=>/.test(trimmed) }));
      if (vis === 'public') facts.push(published(`pub:${name}:${lineNumber}`, Language.CSharp, context.filePath, lineNumber, name, factId));
    }
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.CSharp, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const csharpFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.CSharp,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
