import { Language } from '../../shared/languages.js';
import type { FactDiagnostic } from '../diagnostics.js';
import { createFactBundle, FACT_SCHEMA_VERSION, type FactBundle } from '../fact-bundle.js';
import { TRAITS, declaration, declarationFragment, genericType, heritage, published, typeRef, visibility } from './common.js';
import type { AdapterExtractionContext, AdapterValidationResult, LanguageFactAdapter } from './adapter.js';
import { getLanguageCapabilityDescriptor } from '../../languages/capability-registry.js';

const descriptor = getLanguageCapabilityDescriptor(Language.Go);

function isExportedName(name: string): boolean {
  return name[0] === name[0]?.toUpperCase();
}

function ownerFromReceiver(receiver: string): { ownerRef: string; ownerType: ReturnType<typeof typeRef> } {
  const parts = receiver.trim().split(/\s+/);
  const rawType = parts.slice(1).join(' ') || parts[0] || 'unknown';
  const ownerName = rawType.replace(/^\*+/, '').replace(/\[.*\]$/, '');
  return {
    ownerRef: ownerName,
    ownerType: rawType.startsWith('*') ? { kind: 'pointer', text: rawType, target: typeRef(ownerName) } : typeRef(ownerName),
  };
}

function paramsOf(value: string) {
  return value.split(',').map((part) => part.trim()).filter(Boolean).map((part, i) => ({
    name: part.split(/\s+/)[0] || `arg${i}`,
    type: typeRef(part.split(/\s+/).slice(1).join(' ') || 'unknown'),
  }));
}

function typeFromGenerics(name: string, genericPart?: string) {
  if (!genericPart) return undefined;
  const args = genericPart.split(',').map((part) => typeRef(part.trim().split(/\s+/)[0] || 'unknown'));
  return genericType(`${name}[${args.map((arg) => arg.text).join(', ')}]`, name, args);
}

function extract(context: AdapterExtractionContext): FactBundle {
  const facts = [] as FactBundle['facts'][number][];
  const diagnostics: FactDiagnostic[] = [];
  const lines = context.source.split('\n');
  let activeStruct: { factId: string; lineNumber: number } | null = null;
  let activeInterface: { factId: string; lineNumber: number } | null = null;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (activeStruct && trimmed === '}') {
      activeStruct = null;
      continue;
    }
    if (activeInterface && trimmed === '}') {
      activeInterface = null;
      continue;
    }

    if (activeStruct) {
      const embedded = trimmed.match(/^(\*?)([A-Z_a-z][\w\[\]]*)$/);
      if (embedded) {
        facts.push(heritage(`heritage:embed:${activeStruct.factId}:${lineNumber}`, Language.Go, context.filePath, lineNumber, activeStruct.factId, embedded[2], 'mixes-in'));
      }
      continue;
    }

    if (activeInterface) {
      const embedded = trimmed.match(/^([A-Z_a-z][\w\[\]]*)$/);
      if (embedded) {
        facts.push(heritage(`heritage:iface:${activeInterface.factId}:${lineNumber}`, Language.Go, context.filePath, lineNumber, activeInterface.factId, embedded[1], 'extends'));
        continue;
      }
      const methodSig = trimmed.match(/^(\w+)\s*\(([^)]*)\)\s*([^\s{][^{]*)?$/);
      if (methodSig) {
        const factId = `decl:${activeInterface.factId}:${methodSig[1]}:${lineNumber}`;
        facts.push(declaration(factId, Language.Go, context.filePath, lineNumber, 'method', methodSig[1], {
          qualifiedName: `${context.filePath}:${methodSig[1]}`,
          ownerRef: activeInterface.factId,
          visibility: visibility(isExportedName(methodSig[1]) ? 'public' : 'package'),
          signature: {
            parameters: paramsOf(methodSig[2]),
            returnType: methodSig[3] ? typeRef(methodSig[3].trim()) : undefined,
          },
        }));
        facts.push(declarationFragment(`frag:${activeInterface.factId}:${methodSig[1]}:${lineNumber}`, Language.Go, context.filePath, lineNumber, factId, methodSig[1], { hasBody: false }));
      }
      continue;
    }

    const structMatch = trimmed.match(/^type\s+(\w+)\s+struct\s*\{/);
    if (structMatch) {
      const factId = `decl:${structMatch[1]}:${lineNumber}`;
      facts.push(declaration(factId, Language.Go, context.filePath, lineNumber, 'struct', structMatch[1], {
        qualifiedName: `${context.filePath}:${structMatch[1]}`,
        visibility: visibility(isExportedName(structMatch[1]) ? 'public' : 'package'),
        traits: TRAITS.structLike,
      }));
      facts.push(declarationFragment(`frag:${structMatch[1]}:${lineNumber}`, Language.Go, context.filePath, lineNumber, factId, structMatch[1]));
      if (isExportedName(structMatch[1])) facts.push(published(`pub:${structMatch[1]}`, Language.Go, context.filePath, lineNumber, structMatch[1], factId));
      if (!trimmed.includes('}')) activeStruct = { factId, lineNumber };
      continue;
    }

    const interfaceMatch = trimmed.match(/^type\s+(\w+)(?:\[([^\]]+)\])?\s+interface\s*\{/);
    if (interfaceMatch) {
      const factId = `decl:${interfaceMatch[1]}:${lineNumber}`;
      facts.push(declaration(factId, Language.Go, context.filePath, lineNumber, 'interface', interfaceMatch[1], {
        qualifiedName: `${context.filePath}:${interfaceMatch[1]}`,
        visibility: visibility(isExportedName(interfaceMatch[1]) ? 'public' : 'package'),
        traits: TRAITS.interfaceLike,
        type: typeFromGenerics(interfaceMatch[1], interfaceMatch[2]),
      }));
      facts.push(declarationFragment(`frag:${interfaceMatch[1]}:${lineNumber}`, Language.Go, context.filePath, lineNumber, factId, interfaceMatch[1], { hasBody: false }));
      if (isExportedName(interfaceMatch[1])) facts.push(published(`pub:${interfaceMatch[1]}`, Language.Go, context.filePath, lineNumber, interfaceMatch[1], factId));
      if (trimmed.includes('}')) {
        const inlineMembers = trimmed.split('{', 1).length ? trimmed.slice(trimmed.indexOf('{') + 1, trimmed.lastIndexOf('}')) : '';
        const methodSig = inlineMembers.trim().match(/^(\w+)\s*\(([^)]*)\)\s*([^\s{][^{]*)?$/);
        if (methodSig) {
          const inlineFactId = `decl:${factId}:${methodSig[1]}:${lineNumber}`;
          facts.push(declaration(inlineFactId, Language.Go, context.filePath, lineNumber, 'method', methodSig[1], {
            qualifiedName: `${context.filePath}:${methodSig[1]}`,
            ownerRef: factId,
            visibility: visibility(isExportedName(methodSig[1]) ? 'public' : 'package'),
            signature: {
              parameters: paramsOf(methodSig[2]),
              returnType: methodSig[3] ? typeRef(methodSig[3].trim()) : undefined,
            },
          }));
          facts.push(declarationFragment(`frag:${factId}:${methodSig[1]}:${lineNumber}`, Language.Go, context.filePath, lineNumber, inlineFactId, methodSig[1], { hasBody: false }));
        }
      } else {
        activeInterface = { factId, lineNumber };
      }
      continue;
    }

    const methodMatch = trimmed.match(/^func\s+\(([^)]+)\)\s+(\w+)\s*\(([^)]*)\)(?:\s+([^{]+))?/);
    if (methodMatch) {
      const factId = `decl:${methodMatch[2]}:${lineNumber}`;
      const owner = ownerFromReceiver(methodMatch[1]);
      facts.push(declaration(factId, Language.Go, context.filePath, lineNumber, 'method', methodMatch[2], {
        qualifiedName: `${context.filePath}:${methodMatch[2]}`,
        ownerRef: owner.ownerRef,
        type: owner.ownerType,
        visibility: visibility(isExportedName(methodMatch[2]) ? 'public' : 'package'),
        signature: {
          parameters: paramsOf(methodMatch[3]),
          returnType: methodMatch[4] ? typeRef(methodMatch[4].trim()) : undefined,
        },
      }));
      facts.push(declarationFragment(`frag:${methodMatch[2]}:${lineNumber}`, Language.Go, context.filePath, lineNumber, factId, methodMatch[2]));
      if (isExportedName(methodMatch[2])) facts.push(published(`pub:${methodMatch[2]}`, Language.Go, context.filePath, lineNumber, methodMatch[2], factId));
      continue;
    }

    const funcMatch = trimmed.match(/^func\s+(\w+)\s*\(([^)]*)\)(?:\s+([^{]+))?/);
    if (funcMatch) {
      const factId = `decl:${funcMatch[1]}:${lineNumber}`;
      facts.push(declaration(factId, Language.Go, context.filePath, lineNumber, 'function', funcMatch[1], {
        qualifiedName: `${context.filePath}:${funcMatch[1]}`,
        visibility: visibility(isExportedName(funcMatch[1]) ? 'public' : 'package'),
        signature: {
          parameters: paramsOf(funcMatch[2]),
          returnType: funcMatch[3] ? typeRef(funcMatch[3].trim()) : undefined,
        },
      }));
      facts.push(declarationFragment(`frag:${funcMatch[1]}:${lineNumber}`, Language.Go, context.filePath, lineNumber, factId, funcMatch[1]));
      if (isExportedName(funcMatch[1])) facts.push(published(`pub:${funcMatch[1]}`, Language.Go, context.filePath, lineNumber, funcMatch[1], factId));
    }
  }

  return createFactBundle({
    schema: { version: FACT_SCHEMA_VERSION, language: Language.Go, adapterId: descriptor.adapterId },
    facts,
    diagnostics,
  });
}

export const goFactAdapter: LanguageFactAdapter = {
  adapterId: descriptor.adapterId,
  language: Language.Go,
  capabilities: descriptor.capabilities,
  extract,
  validate(bundle: FactBundle): AdapterValidationResult {
    return { ok: true, diagnostics: bundle.diagnostics };
  },
};
