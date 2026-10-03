import type { SlackConnection } from "@aop/common";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { disconnectSlack } from "../../api/inbox";
import { TickRow } from "../../inbox/fields";
import { SlackTest } from "./SlackTest";

const HEALTH_TEXT: Record<SlackConnection["health"], string> = {
  live: "Live",
  connecting: "Connecting…",
  offline: "Reconnecting…",
  "no-events": "Connected, but Slack sends no events",
  revoked: "Slack refused the token",
};

/**
 * The connected workspace: who AOP reads Slack as, how the feed is doing (with the fix when it
 * is not live), the connection test, and Disconnect.
 */
export const SlackConnected = ({
  slack,
  onChanged,
}: {
  slack: SlackConnection;
  onChanged: () => void;
}) => (
  <div data-testid="slack-connected" className="flex flex-col gap-4">
    <section className="flex flex-col gap-0.5 rounded-row border border-border bg-raised px-3 py-2.5">
      <p className="text-[13px] text-text">
        <span className="font-medium">{slack.teamName}</span> as{" "}
        <span className="font-medium">@{slack.userName}</span>
      </p>
      <p
        data-testid="slack-health"
        data-health={slack.health}
        className={cn(
          "text-[12.5px]",
          slack.health === "live"
            ? "text-ok"
            : slack.health === "revoked"
              ? "text-blocked"
              : "text-waiting",
        )}
      >
        {HEALTH_TEXT[slack.health]}
        {slack.lastEventAt ? (
          <span className="text-text-subtle">
            {" "}
            · last event{" "}
            {new Date(slack.lastEventAt).toLocaleString([], {
              timeStyle: "short",
              dateStyle: "short",
            })}
          </span>
        ) : null}
      </p>
      {slack.problem ? (
        <p data-testid="slack-problem" className="text-[12px] text-text-muted">
          {slack.problem}
        </p>
      ) : null}
      {slack.missingScopes.length > 0 ? (
        <p className="text-[12px] text-waiting">
          Missing scopes: {slack.missingScopes.join(", ")}. Add them under User Token Scopes and
          sign in again.
        </p>
      ) : null}
    </section>
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-text">Test the connection</h3>
      <p className="text-[12.5px] text-text-muted">
        Passes only when a real message travels from Slack to AOP.
      </p>
      <SlackTest onPassed={onChanged} />
    </section>
    <Disconnect onDone={onChanged} />
  </div>
);

const Disconnect = ({ onDone }: { onDone: () => void }) => {
  const [open, setOpen] = useState(false);
  const [deleteMessages, setDeleteMessages] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        data-testid="slack-disconnect"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        Disconnect Slack
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="w-[480px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
            <AlertDialogDescription>
              AOP stops reading Slack and forgets the tokens. Your Slack app stays in Slack; remove
              it there if you no longer want it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <TickRow
            testId="slack-disconnect-delete"
            checked={deleteMessages}
            onChange={setDeleteMessages}
          >
            Also delete the stored messages
          </TickRow>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="slack-disconnect-confirm"
              onClick={async () => {
                await disconnectSlack(deleteMessages);
                toast.success("Slack disconnected");
                onDone();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
