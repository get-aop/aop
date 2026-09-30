import type { GitFolderKind } from "@aop/common";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { ApiError, registerRepo } from "../api/client";
import { closeAttachRepoDialog, useDialogs } from "../shell/dialog-store";
import { DirectoryList } from "./attach-repo/DirectoryList";
import { PathBar } from "./attach-repo/PathBar";
import { useDirectoryBrowser } from "./attach-repo/use-directory-browser";

/**
 * Attach repository: a directory browser with a path field on top. Folders that are git
 * repositories carry a badge, a linked worktree can be attached as it is, and the button stays off
 * in any other folder, with the reason beside it.
 */
export const AttachRepoDialog = ({ onAttached }: { onAttached?: (repoId: string) => void }) => {
  const { attachRepo } = useDialogs();
  const browser = useDirectoryBrowser(attachRepo);
  const [attaching, setAttaching] = useState(false);
  const { listing } = browser;

  const attach = async (path: string) => {
    setAttaching(true);
    try {
      const result = await registerRepo(path);
      toast.success(result.alreadyExists ? "Repository already attached" : "Repository attached");
      onAttached?.(result.repoId);
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
      <DialogContent
        data-testid="attach-repo-dialog"
        // The same 560px as New project at any path length: the grid column may shrink below its
        // content, and a small window leaves a margin on both sides.
        className="w-[560px] max-w-[min(560px,calc(100%-2rem))] grid-cols-[minmax(0,1fr)]"
      >
        <DialogHeader>
          <DialogTitle>Attach repository</DialogTitle>
        </DialogHeader>

        <PathBar browser={browser} />

        {browser.error ? (
          <p role="alert" data-testid="attach-repo-error" className="text-[12px] text-blocked">
            {browser.error}
          </p>
        ) : null}

        <DirectoryList
          names={browser.visible}
          gitFolders={listing?.gitFolders ?? {}}
          highlighted={browser.highlighted}
          loading={browser.loading}
          filter={browser.fragment}
          onOpen={browser.open}
        />

        {listing?.worktreeOf && browser.settled ? (
          <MainRepositoryOffer
            path={listing.worktreeOf}
            disabled={attaching}
            onAttach={() => void attach(listing.worktreeOf ?? "")}
          />
        ) : null}

        <DialogFooter className="flex-col sm:flex-row sm:items-center">
          <AttachHint kind={listing?.gitKind ?? null} settled={browser.settled} />
          <Button variant="ghost" size="sm" onClick={closeAttachRepoDialog}>
            Cancel
          </Button>
          <Button
            size="sm"
            data-testid="attach-repo-confirm"
            disabled={!browser.attachable || attaching}
            onClick={() => void attach(listing?.path ?? "")}
          >
            {attaching ? "Attaching…" : "Attach repository"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const HINTS = {
  none: "Open a git repository folder to attach it",
  typing: "Press Enter to open the path you typed",
  worktree: "A linked worktree. Threads get worktrees of their own from the same repository.",
  repository: "A git repository. Threads get worktrees of their own from it.",
} as const;

const AttachHint = ({ kind, settled }: { kind: GitFolderKind | null; settled: boolean }) => (
  <p
    data-testid="attach-repo-hint"
    className="min-w-0 flex-1 text-[11.5px] leading-snug text-text-subtle"
  >
    {HINTS[hintFor(kind, settled)]}
  </p>
);

const hintFor = (kind: GitFolderKind | null, settled: boolean): keyof typeof HINTS => {
  if (kind === null) return "none";
  return settled ? kind : "typing";
};

const MainRepositoryOffer = ({
  path,
  disabled,
  onAttach,
}: {
  path: string;
  disabled: boolean;
  onAttach: () => void;
}) => (
  <button
    type="button"
    data-testid="attach-repo-main-instead"
    title={path}
    disabled={disabled}
    onClick={onAttach}
    className="flex min-w-0 items-center gap-1 text-left text-[12px] text-text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-50"
  >
    <span className="shrink-0">Attach the main repository instead (</span>
    <span dir="rtl" className="min-w-0 truncate text-left">
      <bdi dir="ltr">{path}</bdi>
    </span>
    <span className="shrink-0">)</span>
  </button>
);
