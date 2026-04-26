import type { ResolveStrategy, ResolveContext } from './types.js';

export const wildcardExpandStrategy: ResolveStrategy = {
  name: 'wildcard-expand',
  resolve(rawPath: string, _fromFile: string, context: ResolveContext): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    return context.findByPackage(cleaned);
  },
};
