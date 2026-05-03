/**
 * VS Code Extension — Code Intelligence Platform
 *
 * Features:
 *  - Symbol hover provider: hover → summary from graph API
 *  - Side panel: Symbol Explorer tree view (symbols in current file)
 *  - Status bar: index freshness → click → re-analyze
 *  - "Open in graph" command: right-click → Web UI centered on symbol
 *  - Command palette: Search, Analyze, Health
 *  - Go-to-definition from graph: via URI handler (codeintel://jump?file=...&line=...)
 *  - Settings: codeIntel.serverUrl, codeIntel.token
 */

import * as vscode from 'vscode';

// ── Config helpers ────────────────────────────────────────────────────────────

function getServerUrl(): string {
  return vscode.workspace.getConfiguration('codeIntel').get<string>('serverUrl', 'http://localhost:4747').replace(/\/$/, '');
}

function getToken(): string {
  return vscode.workspace.getConfiguration('codeIntel').get<string>('token', '');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── API helpers ───────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  kind: string;
  filePath: string;
  startLine?: number;
  summary?: string;
}

interface SearchResult {
  nodeId: string;
  name: string;
  kind: string;
  filePath: string;
  score?: number;
}

async function apiSearch(query: string, limit = 20): Promise<SearchResult[]> {
  try {
    const resp = await fetch(`${getServerUrl()}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ query, limit }),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { results: SearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

async function apiNodeDetail(nodeId: string): Promise<{ node: GraphNode; callers: { id: string; name: string }[]; callees: { id: string; name: string }[] } | null> {
  try {
    const resp = await fetch(`${getServerUrl()}/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
      headers: authHeaders(),
    });
    if (!resp.ok) return null;
    return await resp.json() as { node: GraphNode; callers: { id: string; name: string }[]; callees: { id: string; name: string }[] };
  } catch {
    return null;
  }
}

async function apiHealth(): Promise<{ status: string; indexedAt?: string; nodes?: number; edges?: number } | null> {
  try {
    const resp = await fetch(`${getServerUrl()}/api/v1/health`, { headers: authHeaders() });
    if (!resp.ok) return null;
    return await resp.json() as { status: string; indexedAt?: string; nodes?: number; edges?: number };
  } catch {
    return null;
  }
}

async function apiFileSymbols(filePath: string): Promise<SearchResult[]> {
  try {
    const resp = await fetch(`${getServerUrl()}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ query: filePath, limit: 200 }),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { results: SearchResult[] };
    return (data.results ?? []).filter((r) => r.filePath && r.filePath.endsWith(filePath.replace(/.*\//, '')));
  } catch {
    return [];
  }
}

// ── Hover Provider ────────────────────────────────────────────────────────────

class CodeIntelHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    if (!vscode.workspace.getConfiguration('codeIntel').get<boolean>('enableHover', true)) return;

    const wordRange = document.getWordRangeAtPosition(position, /[\w$]+/);
    if (!wordRange) return;
    const word = document.getText(wordRange);
    if (!word || word.length < 2) return;

    const results = await apiSearch(word, 5);
    const match = results.find((r) => r.name === word);
    if (!match) return;

    const detail = await apiNodeDetail(match.nodeId);
    if (!detail) return;

    const { node, callers, callees } = detail;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;

    md.appendMarkdown(`**◈ ${node.kind}** \`${node.name}\`\n\n`);
    if (node.summary) {
      md.appendMarkdown(`${node.summary}\n\n`);
    }
    if (callers.length > 0) {
      md.appendMarkdown(`**Callers:** ${callers.slice(0, 5).map((c) => `\`${c.name}\``).join(', ')}${callers.length > 5 ? ` (+${callers.length - 5})` : ''}\n\n`);
    }
    if (callees.length > 0) {
      md.appendMarkdown(`**Calls:** ${callees.slice(0, 5).map((c) => `\`${c.name}\``).join(', ')}${callees.length > 5 ? ` (+${callees.length - 5})` : ''}\n\n`);
    }
    md.appendMarkdown(`*${node.filePath}${node.startLine ? `:${node.startLine}` : ''}*\n\n`);

    const openUri = vscode.Uri.parse(
      `command:codeIntel.openInGraph?${encodeURIComponent(JSON.stringify({ symbolName: word }))}`,
    );
    md.appendMarkdown(`[Open in Graph](${openUri})`);

    return new vscode.Hover(md, wordRange);
  }
}

// ── Symbol Explorer Tree ──────────────────────────────────────────────────────

class SymbolTreeItem extends vscode.TreeItem {
  constructor(
    public readonly result: SearchResult,
  ) {
    super(result.name, vscode.TreeItemCollapsibleState.None);
    this.description = result.kind;
    this.tooltip = `${result.kind} — ${result.filePath}`;
    this.iconPath = new vscode.ThemeIcon(kindToIcon(result.kind));
    this.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [vscode.Uri.file(result.filePath)],
    };
  }
}

function kindToIcon(kind: string): string {
  switch (kind) {
    case 'function': return 'symbol-function';
    case 'method':   return 'symbol-method';
    case 'class':    return 'symbol-class';
    case 'interface': return 'symbol-interface';
    case 'variable': return 'symbol-variable';
    case 'constant': return 'symbol-constant';
    default:         return 'symbol-misc';
  }
}

class SymbolExplorerProvider implements vscode.TreeDataProvider<SymbolTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SymbolTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private symbols: SearchResult[] = [];

  async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await this.loadSymbols(editor.document.fileName);
    }
    this._onDidChangeTreeData.fire();
  }

  async loadSymbols(filePath: string): Promise<void> {
    this.symbols = await apiFileSymbols(filePath);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SymbolTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SymbolTreeItem[] {
    return this.symbols.map((s) => new SymbolTreeItem(s));
  }
}

// ── Status Bar ────────────────────────────────────────────────────────────────

class CodeIntelStatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'codeIntel.analyze';
    this.item.show();
    this.update();
  }

  async update(): Promise<void> {
    const health = await apiHealth();
    if (!health) {
      this.item.text = '$(graph) Code Intel: offline';
      this.item.tooltip = 'Server not reachable. Click to analyze.';
      this.item.backgroundColor = undefined;
      return;
    }

    if (health.indexedAt) {
      const indexedDate = new Date(health.indexedAt);
      const hoursAgo = Math.round((Date.now() - indexedDate.getTime()) / 3_600_000);
      const when = hoursAgo < 1 ? 'just now' : hoursAgo === 1 ? '1h ago' : `${hoursAgo}h ago`;
      this.item.text = `$(graph) Code Intel: indexed ${when}`;
      this.item.tooltip = `${health.nodes ?? 0} nodes · ${health.edges ?? 0} edges\nClick to re-analyze`;
      const stale = hoursAgo > 24;
      this.item.backgroundColor = stale
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    } else {
      this.item.text = '$(graph) Code Intel: ready';
      this.item.tooltip = 'Click to analyze workspace';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

// ── URI Handler (go-to-definition from graph) ─────────────────────────────────

class CodeIntelUriHandler implements vscode.UriHandler {
  async handleUri(uri: vscode.Uri): Promise<void> {
    // Expected format: vscode://vohongtho.vscode-code-intel/jump?file=...&line=...
    const params = new URLSearchParams(uri.query);
    const file = params.get('file');
    const line = parseInt(params.get('line') ?? '1', 10);

    if (!file) return;

    const fileUri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(doc);
    const lineIndex = Math.max(0, line - 1);
    const pos = new vscode.Position(lineIndex, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
}

// ── Extension activation ──────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Set context flag so views become visible
  vscode.commands.executeCommand('setContext', 'codeIntel.active', true);

  // ── Symbol hover provider ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      new CodeIntelHoverProvider(),
    ),
  );

  // ── Symbol Explorer tree view ─────────────────────────────────────────────
  const explorerProvider = new SymbolExplorerProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codeIntelExplorer', explorerProvider),
  );

  // Refresh explorer when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) await explorerProvider.loadSymbols(editor.document.fileName);
    }),
  );

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = new CodeIntelStatusBar();
  context.subscriptions.push(statusBar);

  // Refresh status bar every 5 minutes
  const statusInterval = setInterval(() => statusBar.update(), 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(statusInterval) });

  // ── URI handler ───────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerUriHandler(new CodeIntelUriHandler()),
  );

  // ── Command: Search ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeIntel.search', async () => {
      const query = await vscode.window.showInputBox({ prompt: 'Search symbols in knowledge graph', placeHolder: 'e.g. runPipeline' });
      if (!query) return;

      const results = await apiSearch(query, 20);
      if (results.length === 0) {
        vscode.window.showInformationMessage(`No symbols found for "${query}"`);
        return;
      }

      const items = results.map((r) => ({
        label: r.name,
        description: r.kind,
        detail: r.filePath,
        result: r,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} results for "${query}"`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (picked) {
        const uri = vscode.Uri.file(picked.result.filePath);
        await vscode.window.showTextDocument(uri);
      }
    }),
  );

  // ── Command: Analyze ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeIntel.analyze', async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsFolder) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      const terminal = vscode.window.createTerminal('Code Intel');
      terminal.show();
      terminal.sendText(`npx code-intel analyze "${wsFolder}"`);

      statusBar.update();
      await explorerProvider.refresh();
    }),
  );

  // ── Command: Health ───────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeIntel.health', async () => {
      const health = await apiHealth();
      if (!health) {
        vscode.window.showErrorMessage('Code Intel server not reachable. Is `code-intel serve` running?');
        return;
      }
      vscode.window.showInformationMessage(
        `Code Intel: ${health.nodes ?? '?'} nodes · ${health.edges ?? '?'} edges · indexed ${health.indexedAt ?? 'unknown'}`,
      );
    }),
  );

  // ── Command: Open in Graph ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeIntel.openInGraph', async (args?: { symbolName?: string }) => {
      let symbol = args?.symbolName;
      if (!symbol) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /[\w$]+/);
          if (wordRange) symbol = editor.document.getText(wordRange);
        }
      }

      const serverUrl = getServerUrl();
      const url = symbol
        ? `${serverUrl}/?search=${encodeURIComponent(symbol)}`
        : serverUrl;

      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  // ── Command: Refresh Explorer ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('codeIntel.refreshExplorer', () => explorerProvider.refresh()),
  );

  // Initial load
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    explorerProvider.loadSymbols(activeEditor.document.fileName);
  }
}

export function deactivate(): void {
  vscode.commands.executeCommand('setContext', 'codeIntel.active', false);
}
