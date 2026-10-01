import { MEMORY_REQUEST_MAX_LENGTH } from "@aop/common";
import { ArrowUpIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import type { MemoryRequest, MemoryRequestState } from "./use-memory-request";

/**
 * The one way to ask Claude for a memory change in words, pinned to the bottom of the screen: the
 * coordinator reads the files, edits or deletes what the request is about, and files a new note
 * in the topic it belongs to. Its reply shows above the field once it is done.
 */
export const MemoryRequestBar = ({ request }: { request: MemoryRequest }) => {
  const [text, setText] = useState("");
  const { state } = request;
  const busy = state.phase === "sending" || state.phase === "working";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    if (await request.send(words)) setText("");
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      data-testid="memory-request"
      data-phase={state.phase}
      className="sticky bottom-0 z-10 -mx-6 mt-2 -mb-10 flex flex-col gap-2 bg-surface/95 px-6 pt-2 pb-4 backdrop-blur-sm"
    >
      <RequestStatus state={state} />
      <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-raised py-1.5 pr-1.5 pl-3.5 focus-within:border-border-bold">
        <input
          data-testid="memory-request-input"
          aria-label="Tell Claude what to change or remove"
          autoComplete="off"
          maxLength={MEMORY_REQUEST_MAX_LENGTH}
          placeholder="Tell Claude what to change or remove"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] text-text outline-none placeholder:text-text-subtle"
        />
        <Button
          type="submit"
          size="icon-sm"
          data-testid="memory-request-send"
          aria-label="Send to Claude"
          title="Send to Claude"
          disabled={busy || text.trim() === ""}
        >
          {busy ? <Spinner className="size-3.5" aria-label="Working" /> : <ArrowUpIcon />}
        </Button>
      </div>
    </form>
  );
};

const RequestStatus = ({ state }: { state: MemoryRequestState }) => {
  if (state.phase === "idle") return null;
  if (state.phase === "refused") {
    return (
      <p role="alert" data-testid="memory-request-status" className="text-[12.5px] text-blocked">
        {state.error}
      </p>
    );
  }
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="memory-request-status"
      className={cn(
        "line-clamp-3 text-[12.5px] leading-relaxed",
        state.phase === "answered" && state.failed ? "text-blocked" : "text-text-muted",
      )}
    >
      {statusText(state)}
    </p>
  );
};

const statusText = (state: Exclude<MemoryRequestState, { phase: "idle" | "refused" }>): string => {
  if (state.phase === "sending") return "Sending to Claude…";
  if (state.phase === "working")
    return "Claude is updating memory. The list refreshes when it is done.";
  if (state.failed) return state.reply || "Claude could not finish the change. Try again.";
  return state.reply || "Done.";
};
