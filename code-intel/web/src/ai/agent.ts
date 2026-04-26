import type { ApiClient, NodeInspectInfo, BlastRadiusResult } from '../api/client';
import type { ChatToolCall, ChatCitation, SearchResult } from '../state/types';

export interface AgentStreamEvent {
  type: 'tool-start' | 'tool-end' | 'final';
  toolCall?: ChatToolCall;
  text?: string;
  citations?: ChatCitation[];
}

export type AgentStream = (ev: AgentStreamEvent) => void;

interface Intent {
  kind: 'overview' | 'find' | 'inspect' | 'impact' | 'callers' | 'callees' | 'grep';
  target?: string;
}

function parseIntent(query: string): Intent {
  const q = query.toLowerCase().trim();
  if (/(overview|architecture|describe.*(code|repo|project)|high.?level|summary of)/.test(q)) {
    return { kind: 'overview' };
  }
  const impact = q.match(/(impact|blast.?radius|what.*depends.*on|breaks if|affected by)\s+(\w[\w./_-]*)/);
  if (impact) return { kind: 'impact', target: impact[2] };
  const callers = q.match(/(who calls|callers of|invocations of)\s+(\w[\w./_-]*)/);
  if (callers) return { kind: 'callers', target: callers[2] };
  const callees = q.match(/(callees of|what does\s+\w[\w./_-]*\s+call|methods called by)\s+(\w[\w./_-]*)/);
  if (callees) return { kind: 'callees', target: callees[2] };
  const inspect = q.match(/(explain|describe|inspect|tell me about)\s+(\w[\w./_-]*)/);
  if (inspect) return { kind: 'inspect', target: inspect[2] };
  const grep = q.match(/^(grep|search text|find string)\s+(.+)$/);
  if (grep) return { kind: 'grep', target: grep[2] };
  return { kind: 'find' };
}

function citationFor(node: { filePath: string; startLine?: number; endLine?: number; id: string }): ChatCitation {
  return {
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    nodeId: node.id,
  };
}

function fmtCite(c: ChatCitation): string {
  const lines = c.startLine
    ? `:${c.startLine}${c.endLine && c.endLine !== c.startLine ? `-${c.endLine}` : ''}`
    : '';
  return `[[${c.filePath}${lines}]]`;
}

export async function runAgent(
  query: string,
  client: ApiClient,
  emit: AgentStream,
): Promise<void> {
  const intent = parseIntent(query);
  const citations: ChatCitation[] = [];

  // Helper: search using vector if available, else text
  const hybridSearch = async (q: string, limit: number) => {
    try {
      const status = await client.vectorStatus();
      if (status.ready) {
        const res = await client.vectorSearch(q, limit);
        if (res.results.length > 0) return res.results;
      }
    } catch { /* fall through */ }
    const res = await client.search(q, limit);
    return res.results;
  };

  if (intent.kind === 'overview') {
    const startCall: ChatToolCall = { tool: 'codebase_map', input: {}, status: 'running' };
    emit({ type: 'tool-start', toolCall: startCall });
    // Pull top-N nodes by category via repeated search probes
    const probes = ['main', 'init', 'class', 'app', 'index', 'config', 'server'];
    const seen = new Map<string, SearchResult>();
    for (const p of probes) {
    try {
      const results = await hybridSearch(p, 6);
        for (const r of results) if (!seen.has(r.nodeId)) seen.set(r.nodeId, r);
      } catch {
        /* ignore */
      }
    }
    const top = [...seen.values()].slice(0, 12);
    emit({
      type: 'tool-end',
      toolCall: { ...startCall, status: 'done', resultSummary: `${top.length} key symbols probed` },
    });

    let text = `## Codebase Overview\n\nI sampled key entry points across the graph. Below are the most prominent symbols, grouped by kind:\n\n`;
    const byKind = new Map<string, SearchResult[]>();
    for (const r of top) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r);
      byKind.set(r.kind, arr);
    }
    for (const [kind, arr] of byKind) {
      text += `**${kind.toUpperCase()}**\n`;
      for (const r of arr) {
        const cite: ChatCitation = { filePath: r.filePath, nodeId: r.nodeId };
        citations.push(cite);
        text += `- \`${r.name}\` ${fmtCite(cite)}\n`;
      }
      text += `\n`;
    }
    text += `\n_Use **inspect <symbol>** to dive deeper, or **impact <symbol>** to see blast radius._`;
    emit({ type: 'final', text, citations });
    return;
  }

  // All other intents start with a search to disambiguate
  const target = intent.target ?? query;
  const searchCall: ChatToolCall = {
    tool: 'find_code',
    input: { query: target, limit: 5 },
    status: 'running',
  };
  emit({ type: 'tool-start', toolCall: searchCall });
  const results = await hybridSearch(target, 5);
  emit({
    type: 'tool-end',
    toolCall: { ...searchCall, status: 'done', resultSummary: `${results.length} matches` },
  });

  if (results.length === 0) {
    if (intent.kind === 'grep') {
      const grepCall: ChatToolCall = {
        tool: 'grep_files',
        input: { pattern: target },
        status: 'running',
      };
      emit({ type: 'tool-start', toolCall: grepCall });
      const { results: hits } = await client.grep(target);
      emit({
        type: 'tool-end',
        toolCall: { ...grepCall, status: 'done', resultSummary: `${hits.length} hits` },
      });
      let text = `Grep for \`${target}\` returned ${hits.length} hits.\n\n`;
      for (const h of hits.slice(0, 15)) {
        const cite: ChatCitation = { filePath: h.file, startLine: h.line };
        citations.push(cite);
        text += `- ${fmtCite(cite)} \`${h.text.slice(0, 80)}\`\n`;
      }
      emit({ type: 'final', text, citations });
      return;
    }
    emit({
      type: 'final',
      text: `No symbols matched \`${target}\` in the knowledge graph. Try a different name or use **grep <pattern>** for raw text search.`,
      citations: [],
    });
    return;
  }

  const top = results[0];

  if (intent.kind === 'find') {
    let text = `Found ${results.length} candidate(s) for \`${target}\`:\n\n`;
    for (const r of results) {
      const cite: ChatCitation = { filePath: r.filePath, nodeId: r.nodeId };
      citations.push(cite);
      text += `- **${r.name}** _(${r.kind})_ ${fmtCite(cite)}\n`;
    }
    text += `\n_Click a citation to focus that node, or ask me to **inspect ${top.name}** for details._`;
    emit({ type: 'final', text, citations });
    return;
  }

  // Inspect / callers / callees
  const inspectCall: ChatToolCall = {
    tool: 'deep_dive',
    input: { symbol_name: top.name },
    status: 'running',
  };
  emit({ type: 'tool-start', toolCall: inspectCall });
  let info: NodeInspectInfo;
  try {
    info = await client.inspectNode(top.nodeId);
  } catch (err) {
    emit({
      type: 'tool-end',
      toolCall: { ...inspectCall, status: 'error', resultSummary: String(err) },
    });
    emit({ type: 'final', text: `Failed to inspect \`${top.name}\`.`, citations });
    return;
  }
  emit({
    type: 'tool-end',
    toolCall: {
      ...inspectCall,
      status: 'done',
      resultSummary: `${info.callers.length} callers, ${info.callees.length} callees`,
    },
  });

  const targetCite = citationFor(info.node);
  citations.push(targetCite);

  if (intent.kind === 'callers') {
    let text = `### Callers of \`${info.node.name}\` ${fmtCite(targetCite)}\n\n${info.callers.length} call site(s):\n\n`;
    for (const c of info.callers.slice(0, 30)) {
      text += `- \`${c.name ?? c.id}\`${c.weight ? ` _(weight ${c.weight})_` : ''}\n`;
    }
    emit({ type: 'final', text, citations });
    return;
  }

  if (intent.kind === 'callees') {
    let text = `### \`${info.node.name}\` calls ${info.callees.length} symbol(s) ${fmtCite(targetCite)}\n\n`;
    for (const c of info.callees.slice(0, 30)) text += `- \`${c.name ?? c.id}\`\n`;
    emit({ type: 'final', text, citations });
    return;
  }

  if (intent.kind === 'impact') {
    const impactCall: ChatToolCall = {
      tool: 'check_impact',
      input: { target: top.name },
      status: 'running',
    };
    emit({ type: 'tool-start', toolCall: impactCall });
    let blast: BlastRadiusResult;
    try {
      blast = await client.blastRadius(top.name, 'callers', 4);
    } catch (err) {
      emit({
        type: 'tool-end',
        toolCall: { ...impactCall, status: 'error', resultSummary: String(err) },
      });
      emit({ type: 'final', text: `Failed to compute blast radius.`, citations });
      return;
    }
    emit({
      type: 'tool-end',
      toolCall: {
        ...impactCall,
        status: 'done',
        resultSummary: `${blast.affectedCount} affected symbols`,
      },
    });
    const byDepth = new Map<number, typeof blast.affected>();
    for (const a of blast.affected) {
      const arr = byDepth.get(a.depth) ?? [];
      arr.push(a);
      byDepth.set(a.depth, arr);
    }
    let text = `### Blast radius of \`${blast.target}\` ${fmtCite(targetCite)}\n\n`;
    text += `Changing this symbol may affect **${blast.affectedCount}** symbol(s):\n\n`;
    for (const [depth, arr] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      if (depth === 0) continue;
      text += `**Hop ${depth}** _(${arr.length})_\n`;
      for (const a of arr.slice(0, 12)) text += `- \`${a.name}\` _(${a.kind})_\n`;
      if (arr.length > 12) text += `- _… and ${arr.length - 12} more_\n`;
      text += `\n`;
    }
    emit({ type: 'final', text, citations });
    return;
  }

  // intent.kind === 'inspect'
  let text = `### \`${info.node.name}\` _(${info.node.kind})_ ${fmtCite(targetCite)}\n\n`;
  if (info.cluster) text += `**Cluster:** \`${info.cluster}\`\n\n`;
  text += `**Connections:** ${info.callers.length} caller(s) · ${info.callees.length} callee(s) · ${info.imports.length} import(s)\n\n`;
  if (info.callers.length) {
    text += `**Callers:**\n`;
    for (const c of info.callers.slice(0, 8)) text += `- \`${c.name ?? c.id}\`\n`;
    text += `\n`;
  }
  if (info.callees.length) {
    text += `**Calls:**\n`;
    for (const c of info.callees.slice(0, 8)) text += `- \`${c.name ?? c.id}\`\n`;
    text += `\n`;
  }
  if (info.extends.length) {
    text += `**Extends:** ${info.extends.map((e) => `\`${e.name}\``).join(', ')}\n\n`;
  }
  if (info.implementsEdges.length) {
    text += `**Implements:** ${info.implementsEdges.map((e) => `\`${e.name}\``).join(', ')}\n\n`;
  }
  if (info.members.length) {
    text += `**Members:** ${info.members.length} (${[...new Set(info.members.map((m) => m.kind))].join(', ')})\n`;
  }
  emit({ type: 'final', text, citations });
}
