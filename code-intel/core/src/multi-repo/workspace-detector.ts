import fs from 'node:fs';
import path from 'node:path';

export type WorkspaceType = 'npm' | 'pnpm' | 'nx' | 'turborepo';

export interface WorkspacePackage {
  name: string;
  path: string; // absolute path
}

export interface WorkspaceInfo {
  type: WorkspaceType;
  root: string;
  packages: WorkspacePackage[];
}

function expandGlob(root: string, pattern: string): string[] {
  // Handle patterns like: packages/*, apps/*, *, packages/**
  // Strip trailing /** or /* to get the prefix dir
  const parts = pattern.replace(/\/\*\*?$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const dir = path.join(root, ...parts);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map(entry => path.join(dir, entry))
    .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

function resolvePackages(root: string, patterns: string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const pattern of patterns) {
    const dirs = expandGlob(root, pattern);
    for (const dir of dirs) {
      const pkgJsonPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) continue;
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { name?: string };
        const name = pkgJson.name ?? path.basename(dir);
        packages.push({ name, path: dir });
      } catch {
        // skip malformed package.json
      }
    }
  }
  return packages;
}

export async function detectWorkspace(root: string): Promise<WorkspaceInfo | null> {
  // 1. Turborepo (check before npm since turbo.json + package.json workspaces)
  const turboJsonPath = path.join(root, 'turbo.json');
  if (fs.existsSync(turboJsonPath)) {
    let patterns: string[] = [];
    const pkgJsonPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { workspaces?: string[] | { packages: string[] } };
        if (pkgJson.workspaces) {
          patterns = Array.isArray(pkgJson.workspaces) ? pkgJson.workspaces : pkgJson.workspaces.packages;
        }
      } catch { /* ignore */ }
    }
    if (patterns.length === 0) {
      // fallback: scan packages/* subdirs
      const fallbackDir = path.join(root, 'packages');
      if (fs.existsSync(fallbackDir)) patterns = ['packages/*'];
    }
    const packages = resolvePackages(root, patterns);
    return { type: 'turborepo', root, packages };
  }

  // 2. npm/yarn workspaces
  const npmPkgJsonPath = path.join(root, 'package.json');
  if (fs.existsSync(npmPkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(npmPkgJsonPath, 'utf-8')) as { workspaces?: string[] | { packages: string[] } };
      if (pkgJson.workspaces) {
        const patterns = Array.isArray(pkgJson.workspaces) ? pkgJson.workspaces : pkgJson.workspaces.packages;
        const packages = resolvePackages(root, patterns);
        return { type: 'npm', root, packages };
      }
    } catch { /* ignore */ }
  }

  // 3. pnpm
  const pnpmYamlPath = path.join(root, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmYamlPath)) {
    const patterns: string[] = [];
    try {
      const content = fs.readFileSync(pnpmYamlPath, 'utf-8');
      let inPackages = false;
      for (const line of content.split('\n')) {
        if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
        if (inPackages) {
          if (/^\s*-\s+/.test(line)) {
            patterns.push(line.replace(/^\s*-\s+/, '').replace(/['"]/g, '').trim());
          } else if (line.trim() && !/^\s/.test(line)) {
            inPackages = false;
          }
        }
      }
    } catch { /* ignore */ }
    const packages = resolvePackages(root, patterns);
    return { type: 'pnpm', root, packages };
  }

  // 4. Nx
  const nxJsonPath = path.join(root, 'nx.json');
  if (fs.existsSync(nxJsonPath)) {
    const packages: WorkspacePackage[] = [];
    // Scan up to 2 levels for project.json files
    const scanForProjects = (dir: string, depth: number) => {
      if (depth > 2) return;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        try {
          if (!fs.statSync(fullPath).isDirectory()) continue;
        } catch { continue; }
        const projectJsonPath = path.join(fullPath, 'project.json');
        if (fs.existsSync(projectJsonPath)) {
          try {
            const proj = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8')) as { name?: string };
            const name = proj.name ?? path.basename(fullPath);
            packages.push({ name, path: fullPath });
          } catch { /* skip */ }
        } else {
          scanForProjects(fullPath, depth + 1);
        }
      }
    };
    scanForProjects(root, 1);
    return { type: 'nx', root, packages };
  }

  return null;
}
