import type { SlackTestCheck, SlackTestReport } from "@aop/common";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { testSlack } from "../../api/inbox";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { messageOf } from "../../inbox/inbox-format";

const CHECK_LABEL: Record<SlackTestCheck["id"], string> = {
  "user-token": "Your Slack account",
  scopes: "Scopes",
  "app-token": "Socket Mode",
  groups: "Groups",
  events: "Events arrive",
};

/**
 * The test that passes only when a real message travels Slack → AOP. "Send it for me" posts
 * "AOP connection test" to the person's own DM, as them, after they confirm, and AOP deletes it
 * once it arrives; otherwise the person sends themselves a message and AOP waits a minute.
 */
export const SlackTest = ({
  tokens,
  onPassed,
}: {
  /** Pasted tokens to test before saving; none tests the saved connection. */
  tokens?: { userToken: string; appToken: string };
  onPassed?: (report: SlackTestReport) => void;
}) => {
  const [running, setRunning] = useState<"send" | "wait" | null>(null);
  const [report, setReport] = useState<SlackTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (sendTestMessage: boolean) => {
    if (sendTestMessage && !(await confirmSend())) return;
    setRunning(sendTestMessage ? "send" : "wait");
    setReport(null);
    setError(null);
    try {
      const result = await testSlack({ ...tokens, sendTestMessage });
      setReport(result);
      if (result.ok) onPassed?.(result);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div data-testid="slack-test" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="slack-test-send"
          disabled={running !== null}
          onClick={() => void run(true)}
        >
          {running === "send" ? "Waiting for the message…" : "Send it for me"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="slack-test-wait"
          disabled={running !== null}
          onClick={() => void run(false)}
        >
          {running === "wait" ? "Waiting up to a minute…" : "I'll send myself a message"}
        </Button>
      </div>
      {running === "wait" ? (
        <p data-testid="slack-test-instructions" className="text-[12.5px] text-text-muted">
          Send yourself a message in Slack now (your own DM). AOP waits up to 60 seconds for it.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-blocked">
          {error}
        </p>
      ) : null}
      {report ? <Checks report={report} /> : null}
    </div>
  );
};

const confirmSend = (): Promise<boolean> =>
  requestConfirmation({
    title: "Send a test message for you?",
    message:
      'AOP posts "AOP connection test" to your own DM in Slack (only you see it), as you, and deletes it as soon as it arrives. Nothing is posted anywhere else.',
    confirmLabel: "Send it",
  });

const Checks = ({ report }: { report: SlackTestReport }) => (
  <ul data-testid="slack-test-checks" data-ok={report.ok} className="flex flex-col gap-1">
    {report.checks.map((check) => (
      <CheckRow key={check.id} check={check} />
    ))}
  </ul>
);

const CHECK_LOOK = {
  ok: { icon: CheckIcon, tone: "text-ok" },
  failed: { icon: XIcon, tone: "text-blocked" },
  skipped: { icon: MinusIcon, tone: "text-text-subtle" },
} as const;

const CheckRow = ({ check }: { check: SlackTestCheck }) => {
  const look = CHECK_LOOK[check.ok === null ? "skipped" : check.ok ? "ok" : "failed"];
  const Icon = look.icon;
  return (
    <li
      data-testid={`slack-check-${check.id}`}
      data-ok={String(check.ok)}
      className="flex items-start gap-2 rounded-row border border-border px-3 py-1.5"
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", look.tone)} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-text">
          <span className="font-medium">{CHECK_LABEL[check.id]}</span>{" "}
          <span className="text-text-muted">{check.detail}</span>
        </p>
        {check.fix ? <p className="text-[12px] text-waiting">{check.fix}</p> : null}
      </div>
    </li>
  );
};
