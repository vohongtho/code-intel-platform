import fs from 'node:fs';
import path from 'node:path';
import { makeRe } from 'minimatch';
import { detectLanguage, getSupportedExtensions } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId } from '../../graph/id-generator.js';

// Pattern matching utilities

/**
 * Check if a pattern contains glob wildcards.
 */
/**
 * Check if a pattern contains glob special characters (*, ?, [, {).
 * Exported for testing.
 */
export function isGlobPattern(pattern: string): boolean {
  return /[*?\[{]/.test(pattern);
}

/**
 * Check if a pattern contains path separators (Unix or Windows).
 * Glob patterns with path separators are still glob patterns, not path patterns.
 * Exported for testing.
 */
export function isPathPattern(pattern: string): boolean {
  // Don't treat glob patterns as path patterns
  if (isGlobPattern(pattern)) return false;
  return pattern.includes('/') || pattern.includes('\\');
}

/**
 * Check if a pattern is a simple basename match (no special characters).
 * Exported for testing.
 */
export function isBasenamePattern(pattern: string): boolean {
  return !isGlobPattern(pattern) && !isPathPattern(pattern);
}

/**
 * Normalize a pattern for consistent matching:
 * - Convert backslashes to forward slashes
 * - Trim whitespace
 * - Remove trailing slashes
 * Exported for testing.
 */
export function normalizePattern(pattern: string): string {
  return pattern
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, ''); // Remove trailing slashes
}

// Cache for compiled glob patterns
const globPatternCache = new Map<string, RegExp>();

interface CompiledGlobPattern {
  pattern: string;
  regex: RegExp;
  usesPath: boolean;
}

interface CompiledPatternSet {
  globs: CompiledGlobPattern[];
  paths: string[];
  basenames: string[];
}

/**
 * Compile a glob pattern to RegExp and cache it.
 * Exported for testing.
 */
export function compileGlobPattern(pattern: string): RegExp | null {
  if (globPatternCache.has(pattern)) {
    return globPatternCache.get(pattern)!;
  }

  try {
    const regex = makeRe(pattern);
    if (regex) {
      globPatternCache.set(pattern, regex);
      return regex;
    }
  } catch (err) {
    // Invalid glob pattern - will be treated as literal string
    console.warn(`Invalid glob pattern "${pattern}": ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

/**
 * Determine if an entry (file or directory) should be skipped based on exclusion patterns.
 * Exported for testing.
 * 
 * @param entryPath - Relative path from workspace root
 * @param entryName - Basename of the entry
 * @param patterns - Array of exclusion patterns
 * @returns true if the entry should be excluded
 */
function compilePatternSet(patterns: string[]): CompiledPatternSet {
  const compiled: CompiledPatternSet = { globs: [], paths: [], basenames: [] };

  for (const rawPattern of patterns) {
    const pattern = normalizePattern(rawPattern);
    if (!pattern) continue;

    if (isGlobPattern(pattern)) {
      const regex = compileGlobPattern(pattern);
      if (regex) {
        compiled.globs.push({ pattern, regex, usesPath: pattern.includes('/') });
      }
      continue;
    }

    if (isPathPattern(pattern)) {
      compiled.paths.push(pattern);
      continue;
    }

    compiled.basenames.push(pattern);
  }

  return compiled;
}

function shouldSkipCompiled(entryPath: string, entryName: string, compiled: CompiledPatternSet): boolean {
  for (const glob of compiled.globs) {
    const target = glob.usesPath ? entryPath : entryName;
    if (glob.regex.test(target)) {
      return true;
    }
  }

  for (const pattern of compiled.paths) {
    if (entryPath === pattern || entryPath.startsWith(pattern + '/')) {
      return true;
    }
  }

  for (const pattern of compiled.basenames) {
    if (entryName === pattern) {
      return true;
    }
  }

  return false;
}

export function shouldSkip(entryPath: string, entryName: string, patterns: string[]): boolean {
  return shouldSkipCompiled(entryPath, entryName, compilePatternSet(patterns));
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'dist-tests', 'build', 'out',
  '__pycache__', '.tox', '.pytest_cache', '.mypy_cache',
  'vendor', 'target', '.code-intel', 'coverage', '.next',
  '.turbo', '.cache', 'tmp', 'temp', '.parcel-cache', '.venv', 'venv',
  '.env', 'env', '__snapshots__', '.nyc_output', 'storybook-static',
]);

/**
 * Load ignore patterns from a single file.
 * Format: one pattern per line, # for comments, empty lines skipped.
 * 
 * @param filePath - Absolute path to the ignore file
 * @returns Set of patterns from the file, or empty Set if file doesn't exist/errors
 */
function loadIgnoreFile(filePath: string): Set<string> {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const patterns = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.add(trimmed);
      }
    }
    return patterns;
  } catch (err) {
    // File doesn't exist or is unreadable - return empty Set
    // Only log if it's not a simple ENOENT (file not found)
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      console.warn(`Warning: Could not read ignore file ${filePath}: ${err.message}`);
    }
    return new Set();
  }
}

/**
 * Get hard-coded file suffix patterns as glob patterns.
 * These are always excluded from analysis.
 */
function getHardCodedFileSuffixPatterns(): string[] {
  const suffixes = ['.d.ts', '.js.map', '.d.ts.map', '.min.js', '.min.css'];
  return suffixes.map(suffix => `*${suffix}`);
}

/**
 * Load and combine all exclusion patterns from multiple layers:
 * 1. Hard-coded file suffixes (always excluded)
 * 2. .codeintelignore (team-level, tracked)
 * 3. .codeintelignore.local (personal, gitignored)
 * 4. CLI-provided patterns (transient, per-run)
 * 
 * @param workspaceRoot - Root directory of the workspace
 * @param cliPatterns - Optional patterns from CLI flags (skipFolders + skipFiles)
 * @returns Array of all exclusion patterns combined
 */
function loadIgnorePatterns(workspaceRoot: string, cliPatterns?: string[]): string[] {
  const allPatterns: string[] = [];

  // Layer 0: Hard-coded file suffixes (as glob patterns)
  allPatterns.push(...getHardCodedFileSuffixPatterns());

  // Layer 1: .codeintelignore (team file)
  const teamPatterns = loadIgnoreFile(path.join(workspaceRoot, '.codeintelignore'));
  allPatterns.push(...teamPatterns);

  // Layer 2: .codeintelignore.local (personal file)
  const localPatterns = loadIgnoreFile(path.join(workspaceRoot, '.codeintelignore.local'));
  allPatterns.push(...localPatterns);

  // Layer 3: CLI patterns (if provided)
  if (cliPatterns && cliPatterns.length > 0) {
    allPatterns.push(...cliPatterns);
  }

  return allPatterns;
}

const IGNORED_FILE_SUFFIXES = ['.d.ts', '.js.map', '.d.ts.map', '.min.js', '.min.css'];
const MAX_FILE_SIZE_BYTES = 512 * 1024; // skip files > 512 KB

export const scanPhase: Phase = {
  name: 'scan',
  dependencies: [],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    const extensions = new Set(getSupportedExtensions());
    const filePaths: string[] = [];
    
    // Collect CLI patterns from context (if provided)
    const cliPatterns: string[] = [];
    if (context.skipFolders) {
      cliPatterns.push(...context.skipFolders);
    }
    if (context.skipFiles) {
      cliPatterns.push(...context.skipFiles);
    }
    
    // Load all exclusion patterns (hard-coded suffixes + ignore files + CLI)
    const patterns = loadIgnorePatterns(
      context.workspaceRoot,
      cliPatterns.length > 0 ? cliPatterns : undefined
    );
    const compiledPatterns = compilePatternSet(patterns);

    const verbose = context.verbose ?? false;

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(context.workspaceRoot, fullPath);
        
        // Skip hidden directories and ignored directories
        if (entry.isDirectory()) {
          // Skip hidden directories (starting with .)
          if (entry.name.startsWith('.')) continue;
          
          // Check hard-coded IGNORED_DIRS
          if (IGNORED_DIRS.has(entry.name)) {
            if (verbose) {
              console.log(`  [skip-dir] ${relativePath} (hard-coded)`);
            }
            continue;
          }
          
          // Check pattern-based exclusions
          if (shouldSkipCompiled(relativePath, entry.name, compiledPatterns)) {
            if (verbose) {
              console.log(`  [skip-dir] ${relativePath} (pattern match)`);
            }
            continue;
          }
          
          // Recursively walk this directory
          walk(fullPath);
        } else if (entry.isFile()) {
          const name = entry.name;
          const ext = path.extname(name);
          
          // Skip files without supported extensions
          if (!extensions.has(ext)) continue;
          
          // Check pattern-based exclusions (includes file suffixes as glob patterns)
          if (shouldSkipCompiled(relativePath, name, compiledPatterns)) {
            if (verbose) {
              console.log(`  [skip-file] ${relativePath} (pattern match)`);
            }
            continue;
          }
          
          // Skip very large files (generated code, minified assets)
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_FILE_SIZE_BYTES) {
              if (verbose) {
                console.log(`  [skip-file] ${relativePath} (size > ${MAX_FILE_SIZE_BYTES} bytes)`);
              }
              continue;
            }
          } catch {
            continue;
          }
          
          filePaths.push(fullPath);
        }
      }
    }

    walk(context.workspaceRoot);
    context.filePaths.push(...filePaths);
    context.onPhaseProgress?.('scan', filePaths.length, filePaths.length);

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

    let structDone = 0;
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
      structDone++;
      context.onPhaseProgress?.('structure', structDone, context.filePaths.length);
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
