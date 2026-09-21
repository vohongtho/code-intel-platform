import { findLanguageCapabilityByExtension, getLanguageCapabilityDescriptors } from '../languages/capability-registry.js';
import { Language } from './languages.js';

const SUPPORTED_EXTENSIONS = getLanguageCapabilityDescriptors().flatMap((descriptor) => [...descriptor.extensions]);

export function detectLanguage(filePath: string): Language | null {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return findLanguageCapabilityByExtension(ext)?.language ?? null;
}

export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}
