import path from 'node:path';
import type { ResolveStrategy, ResolveContext } from './types.js';

export const relativePathStrategy: ResolveStrategy = {
  name: 'relative-path',
  resolve(rawPath: string, fromFile: string, context: ResolveContext): string | null {
    const cleaned = rawPath.replace(/['"]/g, '');
    if (!cleaned.startsWith('.')) return null;
    const fromDir = path.dirname(fromFile);
    return context.resolve(fromDir, cleaned);
  },
};
