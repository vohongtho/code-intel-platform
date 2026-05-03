import React, { useMemo, useState } from 'react';
import { useAppState } from '../../state/app-context';

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: string[];
}

function buildTree(filePaths: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), files: [] };
  for (const fp of filePaths) {
    const parts = fp.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), files: [] });
      }
      node = node.children.get(part)!;
    }
    node.files.push(fp);
  }
  return root;
}

function countLeaves(node: TreeNode): number {
  let count = node.files.length;
  for (const child of node.children.values()) count += countLeaves(child);
  return count;
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  onFileClick: (fp: string) => void;
  selectedPath?: string;
}

function TreeNodeView({ node, depth, onFileClick, selectedPath }: TreeNodeViewProps) {
  const sortedDirs = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedFiles = [...node.files].sort();
  const totalFiles = countLeaves(node);
  const indent = depth * 12;
  const [expanded, setExpanded] = useState(depth <= 1 || node.children.size === 1);

  if (depth === 0) {
    return (
      <>
        {sortedDirs.map(([, child]) => (
          <TreeNodeView key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} selectedPath={selectedPath} />
        ))}
        {sortedFiles.map((fp) => (
          <FileRow key={fp} fp={fp} indent={indent} selected={fp === selectedPath} onClick={() => onFileClick(fp)} />
        ))}
      </>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 pr-2 cursor-pointer hover:bg-hover rounded-sm group transition select-none"
        style={{ paddingLeft: `${indent + 6}px` }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-text-muted text-[10px] w-3 flex-shrink-0 text-center">
          {(sortedDirs.length > 0 || sortedFiles.length > 0) ? (expanded ? '▾' : '▸') : ' '}
        </span>
        <span className="text-[13px] mr-1">{expanded ? '📂' : '📁'}</span>
        <span className="text-xs text-text-secondary font-medium truncate flex-1 group-hover:text-text-primary">
          {node.name}
        </span>
        <span className="text-[10px] text-text-muted/50 font-mono ml-1 flex-shrink-0">{totalFiles}</span>
      </div>

      {expanded && (
        <div>
          {sortedDirs.map(([, child]) => (
            <TreeNodeView key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} selectedPath={selectedPath} />
          ))}
          {sortedFiles.map((fp) => (
            <FileRow key={fp} fp={fp} indent={indent + 16} selected={fp === selectedPath} onClick={() => onFileClick(fp)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ fp, indent, selected, onClick }: { fp: string; indent: number; selected: boolean; onClick: () => void }) {
  const name = fp.split('/').pop()!;
  const ext = name.split('.').pop() ?? '';
  const icon = EXT_ICON[ext] ?? '📄';

  return (
    <div
      className={`flex items-center gap-1 py-0.5 pr-2 cursor-pointer rounded-sm transition select-none ${
        selected
          ? 'bg-accent/15 text-accent'
          : 'hover:bg-hover text-text-muted hover:text-text-secondary'
      }`}
      style={{ paddingLeft: `${indent + 6}px` }}
      onClick={onClick}
      title={fp}
    >
      <span className="text-[11px] mr-1 flex-shrink-0">{icon}</span>
      <span className="text-xs truncate">{name}</span>
    </div>
  );
}

const EXT_ICON: Record<string, string> = {
  ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️',
  json: '📋', md: '📝', py: '🐍', go: '🐹',
  rs: '🦀', java: '☕', cs: '🔵', css: '🎨',
  html: '🌐', yaml: '⚙️', yml: '⚙️', toml: '⚙️',
  sh: '🐚', txt: '📄', gitignore: '🚫',
};

export function SidebarFiles() {
  const { state, dispatch } = useAppState();
  const [search, setSearch] = useState('');

  const filePaths = useMemo(
    () => state.nodes.filter((n) => n.kind === 'file').map((n) => n.filePath).sort(),
    [state.nodes],
  );

  const filteredPaths = useMemo(() => {
    if (!search.trim()) return filePaths;
    const q = search.toLowerCase();
    return filePaths.filter((fp) => fp.toLowerCase().includes(q));
  }, [filePaths, search]);

  const tree = useMemo(() => buildTree(filteredPaths), [filteredPaths]);
  const selectedPath = state.selectedNode?.kind === 'file' ? state.selectedNode.filePath : undefined;

  const onFileClick = (fp: string) => {
    const node = state.nodes.find((n) => n.filePath === fp && n.kind === 'file');
    if (node) dispatch({ type: 'SELECT_NODE', node });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-border-subtle">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter files…"
          className="w-full bg-elevated border border-border-subtle rounded-md px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted focus:border-accent focus:ring-1 focus:ring-accent/20 focus:outline-none transition"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1 text-sm">
        {filteredPaths.length === 0 ? (
          <p className="text-center text-text-muted text-xs mt-4">No files match</p>
        ) : (
          <TreeNodeView node={tree} depth={0} onFileClick={onFileClick} selectedPath={selectedPath} />
        )}
      </div>

      {/* Count */}
      <div className="px-3 py-1.5 border-t border-border-subtle text-[10px] text-text-muted font-mono">
        {filteredPaths.length} file{filteredPaths.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
