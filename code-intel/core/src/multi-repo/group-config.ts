import fs from 'node:fs';
import path from 'node:path';

export interface RepoGroup {
  name: string;
  repos: { name: string; path: string }[];
}

export function loadGroupConfig(configPath: string): RepoGroup | null {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Simple YAML-like parsing (name: value, repos list)
    const lines = content.split('\n');
    let groupName = '';
    const repos: { name: string; path: string }[] = [];
    let inRepos = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;

      if (trimmed.startsWith('name:')) {
        groupName = trimmed.slice(5).trim();
        continue;
      }

      if (trimmed === 'repos:') {
        inRepos = true;
        continue;
      }

      if (inRepos && trimmed.startsWith('- ')) {
        const entry = trimmed.slice(2).trim();
        const colonIdx = entry.indexOf(':');
        if (colonIdx > 0) {
          repos.push({
            name: entry.slice(0, colonIdx).trim(),
            path: entry.slice(colonIdx + 1).trim(),
          });
        } else {
          repos.push({ name: path.basename(entry), path: entry });
        }
      }
    }

    if (!groupName || repos.length === 0) return null;
    return { name: groupName, repos };
  } catch {
    return null;
  }
}

export function saveGroupConfig(configPath: string, group: RepoGroup): void {
  const lines: string[] = [
    `name: ${group.name}`,
    'repos:',
    ...group.repos.map((r) => `  - ${r.name}: ${r.path}`),
  ];
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, lines.join('\n') + '\n');
}
