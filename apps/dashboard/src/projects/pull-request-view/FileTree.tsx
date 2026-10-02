import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { useState } from "react";
import type { FileTreeNode } from "./diff-files";

/** The changed files as folders and files; a file jumps to its diff, a folder folds. */
export const FileTree = ({
  nodes,
  onSelect,
}: {
  nodes: FileTreeNode[];
  onSelect: (path: string) => void;
}) => (
  <ul className="flex flex-col text-meta">
    {nodes.map((node) => (
      <TreeNode key={node.path} node={node} depth={0} onSelect={onSelect} />
    ))}
  </ul>
);

const TreeNode = ({
  node,
  depth,
  onSelect,
}: {
  node: FileTreeNode;
  depth: number;
  onSelect: (path: string) => void;
}) => {
  const [open, setOpen] = useState(true);
  const indent = { paddingLeft: 8 + depth * 12 };
  if (node.kind === "file") {
    return (
      <li>
        <button
          type="button"
          data-testid="pr-file-tree-file"
          data-path={node.path}
          title={node.path}
          onClick={() => onSelect(node.path)}
          style={indent}
          className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-text-muted hover:bg-hover hover:text-text"
        >
          <FileIcon className="size-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-ok">+{node.file.additions}</span>
          <span className="shrink-0 font-mono text-[11px] text-blocked">
            −{node.file.deletions}
          </span>
        </button>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        data-testid="pr-file-tree-dir"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={indent}
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-text-muted hover:bg-hover hover:text-text"
      >
        {open ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <FolderIcon className="size-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {open ? (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
};
