import type { Language } from '../../shared/languages.js';
import type { SemanticAnchors, SourceRange } from '../anchors.js';
import type {
  DeclarationFact,
  HeritageFact,
  ImportBindingFact,
  PublishedNameFact,
  ReferenceFact,
  SemanticKindTraits,
  TypeReferenceFact,
} from '../facts.js';

export function lineRange(filePath: string, lineNumber: number, text: string, startColumn = 0): SourceRange {
  return {
    filePath,
    startLine: lineNumber,
    startColumn,
    endLine: lineNumber,
    endColumn: startColumn + text.length,
  };
}

export function anchors(range: SourceRange): SemanticAnchors {
  return { identity: range, scope: range, documentation: range, render: range };
}

export function typeRef(text: string, extras: Partial<TypeReferenceFact> = {}): TypeReferenceFact {
  return { kind: 'nominal', text, name: text.replace(/^[:&*\s]+/, ''), ...extras };
}

export function callableType(parameterTypes: readonly TypeReferenceFact[], returnType: TypeReferenceFact, text = 'callable'): TypeReferenceFact {
  return { kind: 'callable', text, parameterTypes, returnType };
}

export function containerType(text: string, elements: readonly TypeReferenceFact[]): TypeReferenceFact {
  return { kind: 'container', text, elements };
}

export function pointerType(text: string, target: TypeReferenceFact): TypeReferenceFact {
  return { kind: 'pointer', text, target };
}

export function referenceType(text: string, target: TypeReferenceFact): TypeReferenceFact {
  return { kind: 'reference', text, target };
}

export function genericType(text: string, name: string, args: readonly TypeReferenceFact[]): TypeReferenceFact {
  return { kind: 'generic-application', text, name, arguments: args };
}

export function declaration(
  factId: string,
  language: Language,
  filePath: string,
  lineNumber: number,
  declarationKind: string,
  name: string,
  extras: Partial<DeclarationFact> = {},
): DeclarationFact {
  const sourceRange = lineRange(filePath, lineNumber, name);
  return {
    factId,
    language,
    filePath,
    sourceRange,
    declarationKind,
    name,
    anchors: anchors(sourceRange),
    ...extras,
  };
}

export function published(
  factId: string,
  language: Language,
  filePath: string,
  lineNumber: number,
  publicName: string,
  sourceRef: string,
  publicationKind: PublishedNameFact['publicationKind'] = 'definition',
): PublishedNameFact {
  return {
    factId,
    language,
    filePath,
    sourceRange: lineRange(filePath, lineNumber, publicName),
    moduleRef: filePath,
    publicName,
    sourceRef,
    publicationKind,
  };
}

export function importBinding(
  factId: string,
  language: Language,
  filePath: string,
  lineNumber: number,
  sourceModule: string,
  localName: string,
  importedName?: string,
  bindingKind: ImportBindingFact['bindingKind'] = 'named',
): ImportBindingFact {
  return {
    factId,
    language,
    filePath,
    sourceRange: lineRange(filePath, lineNumber, localName || sourceModule),
    sourceModule,
    localName,
    importedName,
    bindingKind,
  };
}

export function heritage(
  factId: string,
  language: Language,
  filePath: string,
  lineNumber: number,
  declarationRef: string,
  targetText: string,
  heritageKind: HeritageFact['heritageKind'] = 'extends',
): HeritageFact {
  return {
    factId,
    language,
    filePath,
    sourceRange: lineRange(filePath, lineNumber, targetText),
    declarationRef,
    heritageKind,
    target: typeRef(targetText),
  };
}

export function reference(
  factId: string,
  language: Language,
  filePath: string,
  lineNumber: number,
  targetText: string,
  operation: ReferenceFact['operation'],
): ReferenceFact {
  return {
    factId,
    language,
    filePath,
    sourceRange: lineRange(filePath, lineNumber, targetText),
    targetText,
    operation,
  };
}

export const TRAITS = {
  classLike: {
    declaresMembers: true,
    nominalType: true,
    structuralShape: false,
    canImplementInterface: true,
    canReceiveDispatch: true,
    participatesInInheritance: true,
  } satisfies SemanticKindTraits,
  structLike: {
    declaresMembers: true,
    nominalType: true,
    structuralShape: false,
    canImplementInterface: false,
    canReceiveDispatch: false,
    participatesInInheritance: false,
  } satisfies SemanticKindTraits,
  interfaceLike: {
    declaresMembers: true,
    nominalType: false,
    structuralShape: true,
    canImplementInterface: false,
    canReceiveDispatch: false,
    participatesInInheritance: true,
  } satisfies SemanticKindTraits,
  shapeLike: {
    declaresMembers: true,
    nominalType: false,
    structuralShape: true,
    canImplementInterface: false,
    canReceiveDispatch: true,
    participatesInInheritance: false,
  } satisfies SemanticKindTraits,
};
