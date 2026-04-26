import fs from 'node:fs';
import path from 'node:path';
import { detectLanguage, Language } from '../../shared/index.js';
import type { Phase, PhaseResult, PipelineContext } from '../types.js';
import { generateNodeId, generateEdgeId } from '../../graph/id-generator.js';
import type { CodeNode, CodeEdge } from '../../shared/index.js';

export const parsePhase: Phase = {
  name: 'parse',
  dependencies: ['structure'],
  async execute(context: PipelineContext): Promise<PhaseResult> {
    const start = Date.now();
    let symbolCount = 0;

    for (const filePath of context.filePaths) {
      const lang = detectLanguage(filePath);
      if (!lang) continue;

      const relativePath = path.relative(context.workspaceRoot, filePath);
      const fileNodeId = generateNodeId('file', relativePath, relativePath);

      let source: string;
      try {
        source = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      // Store content on file node for search
      const fileNode = context.graph.getNode(fileNodeId);
      if (fileNode) {
        fileNode.content = source.slice(0, 2000);
      }

      const nodes: CodeNode[] = [];
      const edges: CodeEdge[] = [];
      const seen = new Set<string>();

      const lines = source.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

        const extracted = extractSymbol(trimmed, lang, i + 1, relativePath);
        if (!extracted) continue;
        if (seen.has(extracted.name + ':' + extracted.kind)) continue;
        seen.add(extracted.name + ':' + extracted.kind);

        const nodeId = generateNodeId(extracted.kind, relativePath, extracted.name);
        nodes.push({
          id: nodeId,
          kind: extracted.kind,
          name: extracted.name,
          filePath: relativePath,
          startLine: i + 1,
          exported: extracted.exported,
          content: extractBlock(lines, i, 20),
        });
        edges.push({
          id: generateEdgeId(fileNodeId, nodeId, 'contains'),
          source: fileNodeId,
          target: nodeId,
          kind: 'contains',
          weight: 1.0,
        });

        // has_member edge for methods inside classes
        if (extracted.ownerName) {
          const ownerId = generateNodeId('class', relativePath, extracted.ownerName);
          if (context.graph.getNode(ownerId) || nodes.some((n) => n.id === ownerId)) {
            edges.push({
              id: generateEdgeId(ownerId, nodeId, 'has_member'),
              source: ownerId,
              target: nodeId,
              kind: 'has_member',
              weight: 1.0,
            });
          }
        }

        symbolCount++;
      }

      for (const n of nodes) context.graph.addNode(n);
      for (const e of edges) context.graph.addEdge(e);
    }

    return {
      status: 'completed',
      duration: Date.now() - start,
      message: `Extracted ${symbolCount} symbols`,
    };
  },
};

interface ExtractedSymbol {
  kind: CodeNode['kind'];
  name: string;
  exported: boolean;
  ownerName?: string;
}

function extractSymbol(
  line: string,
  lang: Language,
  _lineNum: number,
  _filePath: string,
): ExtractedSymbol | null {
  // --- TypeScript/JavaScript ---
  if (lang === Language.TypeScript || lang === Language.JavaScript) {
    const func = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: line.includes('export') };

    const arrowFunc = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (arrowFunc) return { kind: 'function', name: arrowFunc[1], exported: line.includes('export') };

    const arrowFunc2 = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/);
    if (arrowFunc2) return { kind: 'function', name: arrowFunc2[1], exported: line.includes('export') };

    const cls = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: line.includes('export') };

    const iface = line.match(/^(?:export\s+)?interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: line.includes('export') };

    const enumM = line.match(/^(?:export\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: line.includes('export') };

    const typeAlias = line.match(/^(?:export\s+)?type\s+(\w+)\s*[=<]/);
    if (typeAlias) return { kind: 'type_alias', name: typeAlias[1], exported: line.includes('export') };

    const constVar = line.match(/^(?:export\s+)?const\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=/);
    if (constVar && /^[A-Z_]+$/.test(constVar[1])) {
      return { kind: 'constant', name: constVar[1], exported: line.includes('export') };
    }

    const method = line.match(/^(?:(?:public|private|protected|static|async|readonly)\s+)*(\w+)\s*\(/);
    if (method && !['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor'].includes(method[1])) {
      if (method[1] === 'constructor') {
        return { kind: 'constructor', name: 'constructor', exported: false };
      }
    }
  }

  // --- Python ---
  if (lang === Language.Python) {
    const func = line.match(/^(?:async\s+)?def\s+(\w+)/);
    if (func) return { kind: func[1].startsWith('__') ? 'method' : 'function', name: func[1], exported: !func[1].startsWith('_') };

    const cls = line.match(/^class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !cls[1].startsWith('_') };
  }

  // --- Java ---
  if (lang === Language.Java) {
    const cls = line.match(/(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: line.includes('public') };

    const iface = line.match(/(?:public\s+)?interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: line.includes('public') };

    const enumM = line.match(/(?:public\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: line.includes('public') };

    const method = line.match(/(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(/);
    if (method) return { kind: 'method', name: method[1], exported: line.includes('public') };
  }

  // --- Go ---
  if (lang === Language.Go) {
    const func = line.match(/^func\s+(\w+)\s*\(/);
    if (func) return { kind: 'function', name: func[1], exported: func[1][0] === func[1][0].toUpperCase() };

    const method = line.match(/^func\s+\([^)]+\)\s+(\w+)\s*\(/);
    if (method) return { kind: 'method', name: method[1], exported: method[1][0] === method[1][0].toUpperCase() };

    const structM = line.match(/^type\s+(\w+)\s+struct\b/);
    if (structM) return { kind: 'struct', name: structM[1], exported: structM[1][0] === structM[1][0].toUpperCase() };

    const ifaceM = line.match(/^type\s+(\w+)\s+interface\b/);
    if (ifaceM) return { kind: 'interface', name: ifaceM[1], exported: ifaceM[1][0] === ifaceM[1][0].toUpperCase() };
  }

  // --- Rust ---
  if (lang === Language.Rust) {
    const func = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: line.startsWith('pub') };

    const structM = line.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (structM) return { kind: 'struct', name: structM[1], exported: line.startsWith('pub') };

    const enumM = line.match(/^(?:pub\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: line.startsWith('pub') };

    const traitM = line.match(/^(?:pub\s+)?trait\s+(\w+)/);
    if (traitM) return { kind: 'trait', name: traitM[1], exported: line.startsWith('pub') };

    const implM = line.match(/^impl(?:<[^>]*>)?\s+(\w+)/);
    if (implM) return { kind: 'class', name: implM[1], exported: false };
  }

  // --- C/C++ ---
  if (lang === Language.C || lang === Language.Cpp) {
    const cls = line.match(/^(?:class|struct)\s+(\w+)/);
    if (cls) return { kind: lang === Language.Cpp ? 'class' : 'struct', name: cls[1], exported: true };

    const nsM = line.match(/^namespace\s+(\w+)/);
    if (nsM) return { kind: 'namespace', name: nsM[1], exported: true };

    const func = line.match(/^(?:[\w:*&<>\[\]]+\s+)+(\w+)\s*\([^;]*$/);
    if (func && !['if', 'for', 'while', 'switch', 'return'].includes(func[1])) {
      return { kind: 'function', name: func[1], exported: true };
    }
  }

  // --- C# ---
  if (lang === Language.CSharp) {
    const cls = line.match(/(?:public|internal|private)?\s*(?:static\s+)?(?:abstract\s+)?(?:partial\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: line.includes('public') };

    const iface = line.match(/(?:public\s+)?interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: line.includes('public') };

    const structM = line.match(/(?:public\s+)?struct\s+(\w+)/);
    if (structM) return { kind: 'struct', name: structM[1], exported: line.includes('public') };

    const method = line.match(/(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]?]+)\s+(\w+)\s*\(/);
    if (method) return { kind: 'method', name: method[1], exported: line.includes('public') };

    const nsM = line.match(/namespace\s+([\w.]+)/);
    if (nsM) return { kind: 'namespace', name: nsM[1], exported: true };
  }

  // --- PHP ---
  if (lang === Language.PHP) {
    const cls = line.match(/(?:abstract\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: true };

    const func = line.match(/(?:public|private|protected|static\s+)*function\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: line.includes('public') || !line.includes('private') };

    const iface = line.match(/interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: true };

    const traitM = line.match(/trait\s+(\w+)/);
    if (traitM) return { kind: 'trait', name: traitM[1], exported: true };
  }

  // --- Kotlin ---
  if (lang === Language.Kotlin) {
    const cls = line.match(/(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !line.includes('private') };

    const iface = line.match(/interface\s+(\w+)/);
    if (iface) return { kind: 'interface', name: iface[1], exported: !line.includes('private') };

    const func = line.match(/(?:suspend\s+)?fun\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: !line.includes('private') };

    const obj = line.match(/object\s+(\w+)/);
    if (obj) return { kind: 'class', name: obj[1], exported: !line.includes('private') };
  }

  // --- Ruby ---
  if (lang === Language.Ruby) {
    const cls = line.match(/^class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: true };

    const modM = line.match(/^module\s+(\w+)/);
    if (modM) return { kind: 'module', name: modM[1], exported: true };

    const method = line.match(/^(?:def\s+(?:self\.)?(\w+))/);
    if (method) return { kind: 'method', name: method[1], exported: true };
  }

  // --- Swift ---
  if (lang === Language.Swift) {
    const cls = line.match(/(?:public\s+|open\s+)?(?:final\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !line.includes('private') };

    const structM = line.match(/(?:public\s+)?struct\s+(\w+)/);
    if (structM) return { kind: 'struct', name: structM[1], exported: !line.includes('private') };

    const proto = line.match(/(?:public\s+)?protocol\s+(\w+)/);
    if (proto) return { kind: 'interface', name: proto[1], exported: !line.includes('private') };

    const enumM = line.match(/(?:public\s+)?enum\s+(\w+)/);
    if (enumM) return { kind: 'enum', name: enumM[1], exported: !line.includes('private') };

    const func = line.match(/(?:public\s+|private\s+|internal\s+)?(?:static\s+)?func\s+(\w+)/);
    if (func) return { kind: 'function', name: func[1], exported: !line.includes('private') };
  }

  // --- Dart ---
  if (lang === Language.Dart) {
    const cls = line.match(/(?:abstract\s+)?class\s+(\w+)/);
    if (cls) return { kind: 'class', name: cls[1], exported: !cls[1].startsWith('_') };

    const func = line.match(/^(?:\w+\s+)?(\w+)\s*\(/);
    if (func && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(func[1])) {
      return { kind: 'function', name: func[1], exported: !func[1].startsWith('_') };
    }
  }

  return null;
}

function extractBlock(lines: string[], startIdx: number, maxLines: number): string {
  const end = Math.min(startIdx + maxLines, lines.length);
  return lines.slice(startIdx, end).join('\n');
}
