import type { GitFolderKind } from "@aop/common";
import { FolderIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/ui/badge";

interface DirectoryListProps {
  names: string[];
  gitFolders: Record<string, GitFolderKind>;
  highlighted: number;
  loading: boolean;
  /** Set while the list is narrowed to names that begin with what was typed. */
  filter: string;
  onOpen: (name: string) => void;
}

export const DirectoryList = ({
  names,
  gitFolders,
  highlighted,
  loading,
  filter,
  onOpen,
}: DirectoryListProps) => {
  const highlightedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (highlighted >= 0) highlightedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      data-testid="attach-repo-list"
      className="flex max-h-72 min-h-40 flex-col gap-0.5 overflow-y-auto"
    >
      {names.map((name, index) => (
        <button
          key={name}
          ref={index === highlighted ? highlightedRef : undefined}
          type="button"
          data-testid="attach-repo-dir"
          data-git-kind={gitFolders[name]}
          data-highlighted={index === highlighted}
          // The path field keeps focus, so a click opens a folder without ending what was typed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpen(name)}
          className="flex min-w-0 items-center gap-2 rounded-row px-2 py-1.5 text-left text-[12.5px] text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text data-[highlighted=true]:bg-hover data-[highlighted=true]:text-text"
        >
          <FolderIcon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <GitKindBadge kind={gitFolders[name]} testId="attach-repo-dir-git-badge" />
        </button>
      ))}
      {!loading && names.length === 0 ? (
        <p className="px-2 py-4 text-center text-[12px] text-text-subtle">
          {filter ? `No folder starts with “${filter}”` : "No folders here"}
        </p>
      ) : null}
    </div>
  );
};

export const GitKindBadge = ({
  kind,
  testId,
}: {
  kind: GitFolderKind | undefined;
  testId: string;
}) =>
  kind ? (
    <Badge variant="tag" data-testid={testId} data-kind={kind}>
      <GitBranchIcon className="size-3" />
      {kind === "worktree" ? "worktree" : "git"}
    </Badge>
  ) : null;
