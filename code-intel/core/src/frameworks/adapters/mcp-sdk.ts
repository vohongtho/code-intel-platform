import { Language } from '../../shared/languages.js';
import { createFactBundle, FACT_SCHEMA_VERSION } from '../../semantic/fact-bundle.js';
import type { FactBundle } from '../../semantic/fact-bundle.js';
import { declaration } from '../../semantic/adapters/common.js';
import { summarizeFrameworkDetection } from '../detection.js';
import type { FrameworkAdapter, FrameworkDetectionSignal, RepositoryFactView } from '../contracts.js';

const VERSION = '0.1.0';

function detectSignals(view: RepositoryFactView): FrameworkDetectionSignal[] {
  const signals: FrameworkDetectionSignal[] = [];
  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    if (/modelcontextprotocol|@modelcontextprotocol\/sdk/.test(source)) {
      signals.push({ kind: filePath.endsWith('.json') ? 'dependency' : 'import', strength: 'strong', filePath, value: 'mcp sdk' });
    }
    if (/registerTool\(|registerResource\(|registerPrompt\(|server\.tool\(|server\.resource\(|server\.prompt\(/.test(source)) {
      signals.push({ kind: 'registration', strength: 'strong', filePath, value: 'mcp registration' });
    }
  }
  return signals;
}

function extractFacts(view: RepositoryFactView): FactBundle['facts'] {
  const facts: FactBundle['facts'][number][] = [];

  for (const filePath of view.filePaths) {
    const source = view.fileCache.get(filePath) ?? '';
    if (!source) continue;
    const relPath = filePath.replace(/^.*?code-intel-platform\//, '');
    const lines = source.split('\n');

    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      const toolMatch = trimmed.match(/(?:registerTool|server\.tool)\((['"])(.*?)\1(?:\s*,\s*(\{.*\}))?(?:\s*,\s*(\w+))?/);
      if (toolMatch) {
        const handler = toolMatch[4] ?? toolMatch[2];
        const handlerRef = `mcp:tool:${relPath}:${handler}`;
        facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'function', handler));
        facts.push({
          factId: `mcp:tool-reg:${relPath}:${toolMatch[2]}:${lineNumber}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          registrationKind: 'mcp-tool',
          subjectRef: handlerRef,
          targetText: toolMatch[2],
          framework: 'mcp-sdk',
          frameworkEvidence: { frameworkId: 'mcp-sdk', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
        continue;
      }

      const resourceMatch = trimmed.match(/(?:registerResource|server\.resource)\((['"])(.*?)\1(?:\s*,\s*(\{.*\}))?(?:\s*,\s*(\w+))?/);
      if (resourceMatch) {
        const handler = resourceMatch[4] ?? resourceMatch[2];
        const handlerRef = `mcp:resource:${relPath}:${handler}`;
        facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'function', handler));
        facts.push({
          factId: `mcp:resource-reg:${relPath}:${resourceMatch[2]}:${lineNumber}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          registrationKind: 'mcp-resource',
          subjectRef: handlerRef,
          targetText: resourceMatch[2],
          framework: 'mcp-sdk',
          frameworkEvidence: { frameworkId: 'mcp-sdk', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
        continue;
      }

      const promptMatch = trimmed.match(/(?:registerPrompt|server\.prompt)\((['"])(.*?)\1(?:\s*,\s*(\{.*\}))?(?:\s*,\s*(\w+))?/);
      if (promptMatch) {
        const handler = promptMatch[4] ?? promptMatch[2];
        const handlerRef = `mcp:prompt:${relPath}:${handler}`;
        facts.push(declaration(handlerRef, Language.TypeScript, relPath, lineNumber, 'function', handler));
        facts.push({
          factId: `mcp:prompt-reg:${relPath}:${promptMatch[2]}:${lineNumber}`,
          language: Language.TypeScript,
          filePath: relPath,
          sourceRange: { filePath: relPath, startLine: lineNumber, startColumn: 0, endLine: lineNumber, endColumn: trimmed.length },
          registrationKind: 'mcp-prompt',
          subjectRef: handlerRef,
          targetText: promptMatch[2],
          framework: 'mcp-sdk',
          frameworkEvidence: { frameworkId: 'mcp-sdk', adapterVersion: VERSION, registrationText: trimmed, exact: true },
        });
      }
    }
  }

  return facts;
}

export const mcpSdkFrameworkAdapter: FrameworkAdapter = {
  id: 'mcp-sdk',
  version: VERSION,
  languages: [Language.TypeScript, Language.JavaScript],
  detect(view: RepositoryFactView) {
    return summarizeFrameworkDetection(detectSignals(view), this.id, this.version);
  },
  extract(view: RepositoryFactView) {
    return createFactBundle({
      schema: {
        version: FACT_SCHEMA_VERSION,
        language: Language.TypeScript,
        adapterId: 'framework:mcp-sdk',
        frameworkDetections: ['mcp-sdk'],
      },
      facts: extractFacts(view),
      diagnostics: [],
    });
  },
};
