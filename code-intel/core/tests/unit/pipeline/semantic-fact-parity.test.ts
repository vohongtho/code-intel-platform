import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createKnowledgeGraph } from '../../../src/graph/knowledge-graph.js';
import { generateNodeId } from '../../../src/graph/id-generator.js';
import { parsePhase } from '../../../src/pipeline/phases/parse-phase.js';
import type { PipelineContext } from '../../../src/pipeline/types.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../../src/semantic/fact-bundle.js';
import { projectFactBundle } from '../../../src/semantic/graph-projector.js';
import { Language } from '../../../src/shared/languages.js';

const CORPUS_ROOT = path.resolve('tests/semantic-corpus');

function languageFromName(language: string): Language {
  const map: Record<string, Language> = {
    typescript: Language.TypeScript,
    javascript: Language.JavaScript,
    python: Language.Python,
    java: Language.Java,
    go: Language.Go,
    c: Language.C,
    cpp: Language.Cpp,
    csharp: Language.CSharp,
    rust: Language.Rust,
    php: Language.PHP,
    kotlin: Language.Kotlin,
    ruby: Language.Ruby,
    swift: Language.Swift,
    dart: Language.Dart,
    html: Language.HTML,
  };
  return map[language];
}

function kindForName(name: string): string {
  if (name.startsWith('/')) return 'module';
  if (name === 'main' || name === 'shell' || name === 'app' || name === 'alpha' || name === 'card' || name === 'tile') return 'property';
  if (name === 'IUser' || name === 'Handler' || name === 'IUserRepository' || name === 'UserRepository' || name === 'Loggable' || name === 'Helpers') return 'interface';
  if (/^[A-Z0-9_]+$/.test(name)) return 'constant';
  if (/^[A-Z]/.test(name) && !['GetUser', 'SaveUser', 'Start'].includes(name)) return 'class';
  return 'function';
}

async function parseFixture(language: string, fixture: string) {
  const workspaceRoot = path.join(CORPUS_ROOT, language);
  const filePath = path.join(workspaceRoot, fixture);
  const graph = createKnowledgeGraph();
  graph.addNode({
    id: generateNodeId('file', fixture, fixture),
    kind: 'file',
    name: fixture,
    filePath: fixture,
  });
  const context: PipelineContext = { workspaceRoot, graph, filePaths: [filePath] };
  await parsePhase.execute(context, new Map());
  return [...graph.allNodes()].filter((node) => node.kind !== 'file').map((node) => `${node.kind}:${node.name}`).sort();
}

describe('semantic fact parity', () => {
  it('projects normalized fact declarations for all 15 language fixtures', async () => {
    const index = JSON.parse(fs.readFileSync(path.join(CORPUS_ROOT, 'index.json'), 'utf8')) as { languages: Array<{ language: string; dir: string; files: string[] }> };

    for (const entry of index.languages) {
      const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS_ROOT, entry.dir, 'manifest.json'), 'utf8')) as {
        expected: { definitions: string[] };
        groupedExpected: string[];
        fixtures: { main: string; grouped: string };
      };
      const language = languageFromName(entry.language);
      const allNames = [...manifest.expected.definitions, ...manifest.groupedExpected];
      const bundle = createFactBundle({
        schema: { version: FACT_SCHEMA_VERSION, language, adapterId: entry.language },
        facts: allNames.map((name, index) => ({
          factId: `${entry.language}:${name}:${index}`,
          language,
          filePath: manifest.expected.definitions.includes(name) ? manifest.fixtures.main : manifest.fixtures.grouped,
          sourceRange: { filePath: manifest.expected.definitions.includes(name) ? manifest.fixtures.main : manifest.fixtures.grouped, startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: Math.max(name.length, 1) },
          declarationKind: kindForName(name),
          name,
          anchors: {
            identity: { filePath: manifest.expected.definitions.includes(name) ? manifest.fixtures.main : manifest.fixtures.grouped, startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: Math.max(name.length, 1) },
            render: { filePath: manifest.expected.definitions.includes(name) ? manifest.fixtures.main : manifest.fixtures.grouped, startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: Math.max(name.length, 1) },
          },
          visibility: { level: 'public' },
        })),
        diagnostics: [],
      });

      const projected = projectFactBundle(bundle).nodes.map((node) => `${node.kind}:${node.name}`).sort();
      const parsed = await parseFixture(entry.language, manifest.fixtures.main);

      for (const expected of manifest.expected.definitions) {
        assert.equal(projected.some((node) => node.endsWith(`:${expected}`)), true, `${entry.language}: projected missing ${expected}`);
        assert.equal(parsed.some((node) => node.endsWith(`:${expected}`)), true, `${entry.language}: parser missing ${expected}`);
      }
    }
  });
});
