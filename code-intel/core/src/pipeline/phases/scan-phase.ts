import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage, getSupportedExtensions } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId } from '../../graph/id-generator.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'dist-tests', 'build', 'out',
  '__pycache__', '.tox', '.pytest_cache', '.mypy_cache',
  'vendor', 'target', '.code-intel', 'coverage', '.next',
  '.turbo', '.cache', 'tmp', 'temp', '.parcel-cache',
]);

/**
 * Load extra ignore patterns from .codeintelignore in the workspace root.
 * Format: one glob/dir name per line, # for comments.
 */
function loadIgnorePatterns(workspaceRoot: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, '.codeintelignore'), 'utf-8');
    const extras = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) extras.add(trimmed);
    }
    return extras;
  } catch {
    return new Set();
  }
}

const IGNORED_EXTENSIONS = new Set(['.d.ts', '.js.map', '.d.ts.map']);

export const scanPhase: Phase = {
  name: 'scan',
  dependencies: [],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const extensions = new Set(getSupportedExtensions());
    const filePaths: string[] = [];
    const extraIgnore = loadIgnorePatterns(context.workspaceRoot);

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        if (IGNORED_DIRS.has(entry.name) && entry.isDirectory()) continue;
        if (extraIgnore.has(entry.name) && entry.isDirectory()) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          const fullName = entry.name;
          // Skip declaration files and maps
          if (fullName.endsWith('.d.ts') || fullName.endsWith('.js.map') || fullName.endsWith('.d.ts.map')) continue;
          if (extensions.has(ext)) {
            filePaths.push(fullPath);
          }
        }
      }
    }

    walk(context.workspaceRoot);
    context.filePaths.push(...filePaths);

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Found ${filePaths.length} source files`,
    };
  },
};

export const structurePhase: Phase = {
  name: 'structure',
  dependencies: ['scan'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const dirs = new Set<string>();

    for (const filePath of context.filePaths) {
      const relativePath = path.relative(context.workspaceRoot, filePath);
      const lang = detectLanguage(filePath);

      context.graph.addNode({
        id: generateNodeId('file', relativePath, relativePath),
        kind: 'file',
        name: path.basename(filePath),
        filePath: relativePath,
        metadata: lang ? { language: lang } : undefined,
      });

      // Collect directories
      let dir = path.dirname(relativePath);
      while (dir && dir !== '.' && dir !== '') {
        if (dirs.has(dir)) break;
        dirs.add(dir);
        dir = path.dirname(dir);
      }
    }

    for (const dir of dirs) {
      context.graph.addNode({
        id: generateNodeId('directory', dir, dir),
        kind: 'directory',
        name: path.basename(dir),
        filePath: dir,
      });
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Created ${context.filePaths.length} file nodes, ${dirs.size} directory nodes`,
    };
  },
};
