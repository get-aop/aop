import { FolderIcon, GitBranchIcon } from "lucide-react";

import { Badge } from "@/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog";
import { closeNewSessionDialog, openAttachRepoDialog, useDialogs } from "../shell/dialog-store";
import { useRailProps } from "../shell/rail-store";

/**
 * “New session in…” repo chooser — port of SidebarV2NewThreadDialog behavior:
 * 380px, first row focused, ↵ confirms, dashed “Attach repository” tail (§6.5).
 */
export const NewSessionDialog = () => {
  const { newSession } = useDialogs();
  const rail = useRailProps();

  const pick = (repoId: string) => {
    closeNewSessionDialog();
    rail?.onNewSession(repoId);
  };

  return (
    <Dialog open={newSession} onOpenChange={(open) => (open ? undefined : closeNewSessionDialog())}>
      <DialogContent className="w-[380px] gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="px-4 pt-4 pb-2 text-[13px] font-semibold">
          New session in…
        </DialogTitle>
        <Command data-testid="new-session-dialog">
          <CommandGroup>
            <CommandList className="max-h-72">
              <CommandEmpty>No repositories</CommandEmpty>
              {(rail?.groups ?? []).map((group) => (
                <CommandItem
                  key={group.repoId}
                  value={group.name}
                  onSelect={() => pick(group.repoId)}
                  className="gap-2 px-4"
                >
                  <FolderIcon className="size-4 text-text-subtle" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  {group.sessions[0]?.branch ? (
                    <Badge variant="tag">
                      <GitBranchIcon className="size-3" />
                      {group.sessions[0].branch}
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </CommandGroup>
        </Command>
        <button
          type="button"
          data-testid="new-session-attach-repo"
          onClick={() => {
            closeNewSessionDialog();
            openAttachRepoDialog();
          }}
          className="m-2 mt-1 flex h-9 items-center justify-center gap-2 rounded-row border border-dashed border-border-strong text-[12.5px] text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          Attach repository
        </button>
      </DialogContent>
    </Dialog>
  );
};
