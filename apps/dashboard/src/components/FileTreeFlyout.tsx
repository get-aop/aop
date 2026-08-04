import { FileIcon as FileGlyphIcon, FolderIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

interface FileTreeFlyoutProps {
  files: string[];
  activeFile: string;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

const insertPart = (
  current: TreeNode[],
  name: string,
  path: string,
  filePath: string,
  isFile: boolean,
): TreeNode[] => {
  const found = current.find((n) => n.name === name);
  if (found) return found.children;
  const node: TreeNode = { name, path: isFile ? filePath : path, children: [] };
  current.push(node);
  return node.children;
};

const buildTree = (files: string[]): TreeNode[] => {
  const root: TreeNode[] = [];

  for (const filePath of files) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i] as string;
      const path = parts.slice(0, i + 1).join("/");
      current = insertPart(current, name, path, filePath, i === parts.length - 1);
    }
  }

  return root;
};

const FolderGlyph = () => (
  <FolderIcon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
);

const TreeItem = ({
  node,
  activeFile,
  onSelect,
  depth,
}: {
  node: TreeNode;
  activeFile: string;
  onSelect: (path: string) => void;
  depth: number;
}) => {
  const isFolder = node.children.length > 0;
  const isActive = !isFolder && node.path === activeFile;

  return (
    <>
      <button
        type="button"
        onClick={() => !isFolder && onSelect(node.path)}
        className={`focus-ring flex w-full items-center gap-1.5 rounded-control px-2 py-1 text-left text-[11.5px] transition duration-200 ${
          isActive
            ? "bg-favorite/10 text-favorite"
            : isFolder
              ? "text-text-subtle"
              : "cursor-pointer text-text-muted hover:bg-raised hover:text-text"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        data-testid={isFolder ? `folder-${node.name}` : `file-${node.path}`}
      >
        {isFolder ? (
          <FolderGlyph />
        ) : (
          <FileGlyphIcon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
        )}
        {node.name}
      </button>
      {isFolder &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            activeFile={activeFile}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </>
  );
};

export const FileTreeFlyout = ({ files, activeFile, onSelectFile }: FileTreeFlyoutProps) => {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const tree = useMemo(() => buildTree(files), [files]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (path: string) => {
    onSelectFile(path);
    setOpen(false);
  };

  const openPanel = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPanelPos({ top: rect.top, left: rect.right + 6 });
    setOpen(true);
  }, []);

  return (
    <div className="relative shrink-0" data-testid="file-tree-flyout">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        onMouseEnter={openPanel}
        className="focus-ring flex h-6 w-6 cursor-pointer items-center justify-center rounded-pill border border-border bg-raised p-1 text-text-muted transition duration-200 hover:border-border-strong hover:bg-raised hover:text-text"
        data-testid="flyout-pill"
        aria-label="Toggle file tree"
      >
        <FolderGlyph />
      </button>

      {open && (
        <div
          className="fixed z-[var(--z-menu)] min-w-[200px] rounded-card border border-border bg-surface p-2 shadow-2"
          style={{ top: panelPos.top, left: panelPos.left }}
          onMouseLeave={() => setOpen(false)}
          data-testid="flyout-panel"
          role="tree"
        >
          <div className="text-[11px] mb-1 px-2 text-text-muted">Task files</div>
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              activeFile={activeFile}
              onSelect={handleSelect}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
};
