import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Kbd } from "@/ui/kbd";
import type { SendResult } from "./project-chat";
import { useDraft } from "./use-draft";

/**
 * Where the person writes to the coordinator (or, with another `send`, to a thread). Enter
 * sends and Shift+Enter starts a new line; what is typed survives a reload; a send that fails
 * gives the text back with the reason. `chips` sit in the footer, before the send button.
 * With `onStop`, a Stop button sits beside Send and Escape does the same: the agent is at work
 * and the person may want it to end.
 */
export const Composer = ({
  draftId,
  placeholder,
  disabledReason,
  send,
  chips,
  focusKey,
  onStop,
  compact = false,
}: {
  /** Identifies the conversation the draft belongs to. */
  draftId: string;
  placeholder: string;
  /** Why nothing can be sent now; the composer says so instead of taking input. */
  disabledReason: string | null;
  send: (text: string) => Promise<SendResult>;
  chips?: ReactNode;
  /** When it is set, the cursor moves into the composer as the conversation opens. */
  focusKey?: string;
  onStop?: () => void;
  /** One line with Send beside it and no footer, for a box that sits inside a card. */
  compact?: boolean;
}) => {
  const [draft, setDraft] = useDraft(draftId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const disabled = disabledReason !== null;
  const canSend = draft.trim() !== "" && !sending && !disabled;

  useEffect(() => {
    if (focusKey !== undefined && !disabled) input.current?.focus();
  }, [focusKey, disabled]);

  const submit = async () => {
    if (!canSend) return;
    const text = draft.trim();
    setSending(true);
    setError(null);
    setDraft("");
    const result = await send(text);
    setSending(false);
    if (!result.ok) {
      // Give the text back, unless the person has already started something new.
      setDraft((current) => (current === "" ? text : current));
      setError(result.error);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && onStop) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div
      data-testid="composer"
      data-disabled={disabled}
      className={cn(
        "rounded-composer border border-border-strong bg-input-surface transition-colors duration-[120ms] focus-within:border-border-bold",
        compact && "flex flex-wrap items-end",
        disabled && "opacity-70",
      )}
    >
      <textarea
        ref={input}
        data-testid="composer-input"
        value={draft}
        rows={1}
        disabled={disabled}
        placeholder={disabledReason ?? placeholder}
        aria-label={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          "block max-h-[220px] resize-none bg-transparent px-4 text-[14px] leading-[20px] text-text outline-none [field-sizing:content] placeholder:text-text-subtle disabled:cursor-not-allowed",
          compact ? "min-h-[40px] min-w-0 flex-1 pb-2 pt-2.5" : "min-h-[52px] w-full pb-1 pt-3.5",
        )}
      />
      {error ? (
        <p
          role="alert"
          data-testid="composer-error"
          className={cn("px-4 pb-1 text-[12px] text-blocked", compact && "order-last basis-full")}
        >
          {error}
        </p>
      ) : null}
      <div className={cn("flex items-center gap-1 px-2.5", compact ? "pb-1.5" : "pb-2.5")}>
        <div className="flex min-w-0 flex-1 items-center gap-1">{chips}</div>
        {onStop ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="composer-stop"
            aria-keyshortcuts="Escape"
            onClick={onStop}
            className="mr-1"
          >
            <SquareIcon aria-hidden="true" className="fill-current" />
            Stop
            <Kbd>Esc</Kbd>
          </Button>
        ) : null}
        <button
          type="button"
          data-testid="composer-send"
          aria-label="Send message"
          disabled={!canSend}
          onClick={() => void submit()}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[transform,opacity] duration-150 enabled:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowUpIcon aria-hidden="true" className="size-4" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
};
