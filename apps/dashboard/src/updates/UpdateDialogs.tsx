import { cuaHolderName, type RunningTurn } from "@aop/common";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { getUpdateLog } from "../api/updates";
import { useCuaLease } from "../live-view/cua-lease";
import { openUpdateDialog, useUpdateDialog } from "./update-actions";
import { startUpdate, useUpdates } from "./update-store";

/** The update dialogs, mounted once in the shell so any surface can open them. */
export const UpdateDialogs = () => {
  const open = useUpdateDialog();
  return (
    <>
      <TurnsRunningDialog open={open === "turns"} />
      <UpdateLogDialog open={open === "log"} />
    </>
  );
};

/**
 * "Update host soulf now?": shown only while turns are running. Updating now restarts the host
 * under them; "Update when they finish" queues it on the host itself.
 */
const TurnsRunningDialog = ({ open }: { open: boolean }) => {
  const { status } = useUpdates();
  const lease = useCuaLease();
  const turns = status?.runningTurns ?? [];
  const hostName = status?.hostName ?? "the host";
  const choose = (when: "now" | "idle") => {
    openUpdateDialog(null);
    void startUpdate(when);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : openUpdateDialog(null))}>
      <DialogContent data-testid="update-turns-dialog" className="w-[520px]">
        <DialogHeader>
          <DialogTitle>Update host {hostName} now?</DialogTitle>
          <DialogDescription data-testid="update-turns-running">
            {turnsSentence(turns, hostName)}
            {lease?.holder
              ? ` ${leaseSentence(cuaHolderName(lease.holder), lease.queue.length)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12.5px] leading-relaxed text-text-muted">
          The update restarts the host. The turns keep running (the agents are separate processes,
          and the new host picks them up from their logs), but their chats stop updating for the few
          seconds the restart takes.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            data-testid="update-turns-cancel"
            onClick={() => openUpdateDialog(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-testid="update-turns-now"
            onClick={() => choose("now")}
          >
            Update now
          </Button>
          <Button type="button" data-testid="update-turns-later" onClick={() => choose("idle")}>
            Update when they finish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const turnsSentence = (turns: readonly RunningTurn[], hostName: string): string => {
  if (turns.length === 0) return `No turn is running on ${hostName} now.`;
  const names = turns.slice(0, 3).map((turn) => `“${turn.title}”`);
  const rest = turns.length - names.length;
  const listed = rest > 0 ? `${names.join(", ")} and ${rest} more` : joinNames(names);
  return `${turns.length} ${turns.length === 1 ? "turn is" : "turns are"} running on ${hostName}: ${listed}.`;
};

const joinNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const leaseSentence = (holder: string, waiting: number): string =>
  `“${holder}” is using computer use${waiting > 0 ? `, and ${waiting} ${waiting === 1 ? "thread waits" : "threads wait"} for it` : ""}.`;

/** The end of the host's update log, after a failed update. */
const UpdateLogDialog = ({ open }: { open: boolean }) => {
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLog(null);
    setError(null);
    getUpdateLog().then(setLog, (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not read the update log."),
    );
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : openUpdateDialog(null))}>
      <DialogContent data-testid="update-log-dialog" className="w-[640px]">
        <DialogHeader>
          <DialogTitle>Update log</DialogTitle>
          <DialogDescription>The last lines the host's update wrote.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-[12.5px] text-blocked">
            {error}
          </p>
        ) : (
          <pre
            data-testid="update-log"
            className="max-h-80 overflow-auto rounded-md bg-canvas p-3 text-[11.5px] whitespace-pre-wrap text-text-muted"
          >
            {log ?? "Loading…"}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
};
