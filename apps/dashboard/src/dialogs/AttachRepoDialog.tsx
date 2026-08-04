import { ArrowUpIcon, FolderIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import { ApiError, listDirectories, registerRepo } from "../api/client";
import { closeAttachRepoDialog, useDialogs } from "../shell/dialog-store";

/**
 * Attach repository (PLAN §6.5): 560px directory browser. Git repos get a
 * ⎇ git badge; plain folders descend; footer shows the selected path and
 * enables “Attach repository” only on a git repo.
 */
export const AttachRepoDialog = ({ onAttached }: { onAttached?: () => void }) => {
  const { attachRepo } = useDialogs();
  const requestIdRef = useRef(0);

  const [currentPath, setCurrentPath] = useState("");
  const [directories, setDirectories] = useState<string[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  const fetchDirectoriesRef = useRef<(path?: string) => Promise<void>>(async () => {});
  const fetchDirectories = async (path?: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const result = await listDirectories(path).catch((cause: unknown) => cause);
    if (requestId !== requestIdRef.current) return;
    if (result instanceof Error) {
      setError(result.message);
    } else if (isDirectoryListing(result)) {
      setCurrentPath(result.path);
      setDirectories(result.directories);
      setParentPath(result.parent);
      setIsGitRepo(result.isGitRepo);
    }
    setLoading(false);
  };
  fetchDirectoriesRef.current = fetchDirectories;

  useEffect(() => {
    if (!attachRepo) return;
    requestIdRef.current += 1;
    setError(null);
    setCurrentPath("");
    setDirectories([]);
    setParentPath(null);
    setIsGitRepo(false);
    void fetchDirectoriesRef.current();
  }, [attachRepo]);

  const attach = async () => {
    setAttaching(true);
    try {
      const result = await registerRepo(currentPath);
      toast.success(result.alreadyExists ? "Repository already attached" : "Repository attached");
      onAttached?.();
      closeAttachRepoDialog();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : "Failed to attach repository");
    } finally {
      setAttaching(false);
    }
  };

  return (
    <Dialog
      open={attachRepo}
      onOpenChange={(open) => {
        if (!open) closeAttachRepoDialog();
      }}
    >
      <DialogContent className="w-[560px] max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Attach repository</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1.5 rounded-row border border-border bg-raised px-2.5 py-1.5 font-mono text-[11.5px] text-text-muted">
          {parentPath ? (
            <button
              type="button"
              data-testid="attach-repo-up"
              aria-label="Up one level"
              onClick={() => void fetchDirectories(parentPath)}
              className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
          ) : null}
          <span className="min-w-0 flex-1 truncate" data-testid="attach-repo-path">
            {currentPath || "/"}
          </span>
          {loading ? <Spinner className="size-3 shrink-0" /> : null}
          {isGitRepo ? (
            <Badge variant="tag" data-testid="attach-repo-git-badge">
              <GitBranchIcon className="size-3" />
              git
            </Badge>
          ) : null}
        </div>

        {error ? (
          <p className="text-[12px] text-blocked">{error}</p>
        ) : (
          <DirectoryList
            directories={directories}
            loading={loading}
            onOpen={(name) =>
              void fetchDirectories(currentPath === "/" ? `/${name}` : `${currentPath}/${name}`)
            }
          />
        )}

        <DialogFooter>
          <span className="mr-auto min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle">
            {currentPath || "Select a folder"}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void requestIdRef.current++}>
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="attach-repo-confirm"
            disabled={!isGitRepo || attaching || loading}
            onClick={() => void attach()}
          >
            {attaching ? "Attaching…" : "Attach repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DirectoryList = ({
  directories,
  loading,
  onOpen,
}: {
  directories: string[];
  loading: boolean;
  onOpen: (path: string) => void;
}) => (
  <div
    data-testid="attach-repo-list"
    className="flex max-h-72 min-h-40 flex-col gap-0.5 overflow-y-auto"
  >
    {directories.map((directory) => (
      <button
        key={directory}
        type="button"
        data-testid="attach-repo-dir"
        onClick={() => onOpen(directory)}
        className="flex min-w-0 items-center gap-2 rounded-row px-2 py-1.5 text-left text-[12.5px] text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <FolderIcon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">
          {directory.split("/").filter(Boolean).pop()}
        </span>
      </button>
    ))}
    {!loading && directories.length === 0 ? (
      <p className="px-2 py-4 text-center text-[12px] text-text-subtle">No folders here</p>
    ) : null}
  </div>
);

const isDirectoryListing = (
  value: unknown,
): value is import("../api/client").DirectoryListingResponse =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  "directories" in value &&
  "isGitRepo" in value;
