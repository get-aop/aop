import {
  type CurrentStep,
  currentStepOf,
  describeStep,
  formatElapsed,
  type MessageBlock,
} from "@aop/common";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { useNow } from "../use-now";
import { useChatApi } from "./chat-api";

/**
 * What a message sent while the agent works waits for, so the person never wonders whether it
 * was lost. One written into the running turn waits for the step the agent is on (a long
 * command can hold it for minutes); one held for after the turn waits for the turn to end.
 * Either way "Interrupt now" stops that step and the agent reads the message at once.
 */
export const SteerWaiting = ({
  message,
  blocks,
  align,
}: {
  message: Sent;
  /** The reply being written: what it runs now is the step the message waits on. */
  blocks: readonly MessageBlock[];
  /** The side the message is drawn on: the person's on the right, the coordinator's on the left. */
  align: Align;
}) => {
  const now = useNow(1_000);
  const step = currentStepOf(blocks.filter(isTool));
  return (
    <p
      data-testid="steered-message-caption"
      data-waiting-on={step ? "step" : "writing"}
      className={captionClass(align)}
    >
      <span data-testid="steer-waiting">{waitingText(step, now)}</span>
      <InterruptNow message={message} />
    </p>
  );
};

/** A message held for after the turn: it gets a turn of its own once this one ends. */
export const QueuedNote = ({ message, align }: { message: Sent; align: Align }) => (
  <p data-testid="queued-message-caption" className={captionClass(align)}>
    <span>Queued for after this turn</span>
    <InterruptNow message={message} />
  </p>
);

/** What "Interrupt now" needs of a message: which it is, in which project. */
type Sent = { id: string; projectId: string };
type Align = "start" | "end";

const captionClass = (align: Align): string =>
  cn(
    "flex flex-wrap items-center gap-x-1.5 text-meta text-text-subtle",
    align === "end" ? "justify-end" : "justify-start",
  );

const waitingText = (step: CurrentStep | null, now: number): string => {
  if (!step) return "Waiting for it to finish what it is writing";
  const elapsed = step.tool.startedAt ? formatElapsed(step.tool.startedAt, now) : "";
  return `Waiting for the current step to finish: ${describeStep(step)}${elapsed ? ` · running ${elapsed}` : ""}`;
};

const INTERRUPT_HINT =
  "Stops the step it is on so it reads this now. Anything that step started, even in the background, may stop with it.";

type InterruptState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; reason: string };

const InterruptNow = ({ message }: { message: Sent }) => {
  const api = useChatApi();
  const [state, setState] = useState<InterruptState>({ kind: "idle" });
  const interrupt = async () => {
    setState({ kind: "sending" });
    try {
      await api.interruptForMessage(message.projectId, message.id);
      setState({ kind: "sent" });
    } catch (error) {
      setState({
        kind: "failed",
        reason: error instanceof Error ? error.message : "Could not reach the host",
      });
    }
  };
  // Until the agent takes it in, which draws the message as delivered.
  if (state.kind === "sent") {
    return <span data-testid="steer-interrupted">· Interrupted, it reads this next</span>;
  }
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="steer-interrupt"
            aria-description={INTERRUPT_HINT}
            disabled={state.kind === "sending"}
            onClick={() => void interrupt()}
            className="rounded-md px-1 font-medium text-text-muted underline-offset-2 enabled:hover:text-text enabled:hover:underline disabled:opacity-50"
          >
            {state.kind === "sending" ? "Interrupting…" : "Interrupt now"}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{INTERRUPT_HINT}</TooltipContent>
      </Tooltip>
      {state.kind === "failed" ? (
        <span role="alert" data-testid="steer-interrupt-error" className="basis-full text-blocked">
          Could not interrupt: {state.reason}
        </span>
      ) : null}
    </>
  );
};

const isTool = (block: MessageBlock): block is Extract<MessageBlock, { type: "tool" }> =>
  block.type === "tool";
