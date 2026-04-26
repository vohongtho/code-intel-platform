import type { ResolveStrategy, ResolveContext } from './types.js';

export const namespaceAliasStrategy: ResolveStrategy = {
  name: 'namespace-alias',
  resolve(rawPath: string, _fromFile: string, context: ResolveContext): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    const parts = cleaned.split('.');
    const filePath = parts.join('/');
    for (const suffix of ['/__init__.py', '.py', '/index.ts', '/index.js']) {
      const result = context.findByPackage(filePath + suffix);
      if (result) return result;
    }
    return context.findByPackage(filePath);
  },
};
