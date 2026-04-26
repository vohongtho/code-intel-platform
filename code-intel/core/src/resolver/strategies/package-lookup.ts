import type { ResolveStrategy, ResolveContext } from './types.js';

export const packageLookupStrategy: ResolveStrategy = {
  name: 'package-lookup',
  resolve(rawPath: string, _fromFile: string, context: ResolveContext): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    if (cleaned.startsWith('.')) return null;
    return context.findByPackage(cleaned);
  },
};
