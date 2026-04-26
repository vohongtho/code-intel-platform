import type { CodeEdge } from '../shared/index.js';
import type { LanguageModule, FileSet } from '../languages/types.js';
import { BindingTracker } from './binding-tracker.js';
import type { ImportBinding } from './binding-tracker.js';
import { generateEdgeId } from '../graph/id-generator.js';

export interface ImportInfo {
  rawPath: string;
  localNames: string[];
  isDefault: boolean;
  isNamespace: boolean;
  namespaceName?: string;
}

export interface ImportResolutionResult {
  edges: CodeEdge[];
  bindings: BindingTracker;
}

export function resolveImports(
  filePath: string,
  fileNodeId: string,
  imports: ImportInfo[],
  langModule: LanguageModule,
  workspace: FileSet,
): ImportResolutionResult {
  const bindings = new BindingTracker();
  const edges: CodeEdge[] = [];
  const maxReExportHops = 5;

  for (const imp of imports) {
    let resolvedPath = langModule.resolveImport(imp.rawPath, filePath, workspace);

    // Re-export chain walking
    let hops = 0;
    const visited = new Set<string>();
    while (resolvedPath && hops < maxReExportHops && !visited.has(resolvedPath)) {
      visited.add(resolvedPath);
      hops++;
      // For now, just accept the first resolution
      break;
    }

    if (!resolvedPath) continue;

    const targetNodeId = `file:${resolvedPath}:${resolvedPath}`;
    const edge: CodeEdge = {
      id: generateEdgeId(fileNodeId, targetNodeId, 'imports'),
      source: fileNodeId,
      target: targetNodeId,
      kind: 'imports',
      weight: 0.95,
      label: imp.rawPath,
    };
    edges.push(edge);

    for (const localName of imp.localNames) {
      const binding: ImportBinding = {
        localName,
        sourcePath: resolvedPath,
        exportedName: localName,
        isDefault: imp.isDefault,
        isNamespace: imp.isNamespace,
      };
      bindings.addBinding(filePath, binding);
    }
  }

  return { edges, bindings };
}
