import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Kbd } from "@/ui/kbd";
import { AttachImageButton, ComposerImages } from "./ComposerImages";
import { type UploadImage, useImageAttachments, useImageInput } from "./image-attachments";
import type { SendResult } from "./project-chat";
import { useDraft } from "./use-draft";

/**
 * Where the person writes to the coordinator (or, with another `send`, to a thread). Enter
 * sends and Shift+Enter starts a new line; what is typed survives a reload; a send that fails
 * gives the text back with the reason. `chips` sit in the footer, before the send button.
 * With `onStop`, a Stop button sits beside Send and Escape does the same: the agent is at work
 * and the person may want it to end. With `uploadImage`, images can go with the message: pasted,
 * dropped on the box, or picked with the "+" before the chips. Each uploads as it is added, and a
 * message of images alone may be sent.
 */
export const Composer = ({
  draftId,
  placeholder,
  disabledReason,
  send,
  chips,
  focusKey,
  onStop,
  uploadImage,
  compact = false,
}: {
  /** Identifies the conversation the draft belongs to. */
  draftId: string;
  placeholder: string;
  /** Why nothing can be sent now; the composer says so instead of taking input. */
  disabledReason: string | null;
  /** `images` are the host's ids of the attached images, passed only when there are some. */
  send: (text: string, images?: readonly string[]) => Promise<SendResult>;
  chips?: ReactNode;
  /** When it is set, the cursor moves into the composer as the conversation opens. */
  focusKey?: string;
  onStop?: () => void;
  /** Uploads an image for the message; without it the composer takes text only. */
  uploadImage?: UploadImage;
  /** One line with Send beside it and no footer, for a box that sits inside a card. */
  compact?: boolean;
}) => {
  const input = useRef<HTMLTextAreaElement>(null);
  const disabled = disabledReason !== null;
  const attachments = useImageAttachments(uploadImage);
  const { dragging, onPaste, dropZone } = useImageInput(
    uploadImage !== undefined && !disabled,
    attachments.add,
  );
  const { draft, setDraft, error, canSend, submit } = useComposerSend(
    draftId,
    send,
    attachments,
    disabled,
  );

  useEffect(() => {
    if (focusKey !== undefined && !disabled) input.current?.focus();
  }, [focusKey, disabled]);

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
    <fieldset
      aria-label={placeholder}
      data-testid="composer"
      data-disabled={disabled}
      data-dragging={dragging || undefined}
      {...dropZone}
      className={cn(
        "rounded-composer border border-border-strong bg-input-surface transition-colors duration-[120ms] focus-within:border-border-bold",
        compact && "flex flex-wrap items-end",
        disabled && "opacity-70",
        dragging && "border-border-bold bg-hover",
      )}
    >
      <ComposerImages images={attachments.images} onRemove={attachments.remove} />
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
        onPaste={onPaste}
        className={cn(
          "block max-h-[220px] resize-none bg-transparent px-5 text-body text-text outline-none [field-sizing:content] placeholder:text-text-subtle disabled:cursor-not-allowed",
          compact ? "min-h-[44px] min-w-0 flex-1 pb-2 pt-2.5" : "min-h-[60px] w-full pb-1 pt-4",
        )}
      />
      <ComposerError error={error} compact={compact} />
      <div
        className={cn("flex flex-wrap items-center gap-1 px-2.5", compact ? "pb-1.5" : "pb-2.5")}
      >
        <div className={cn("flex min-w-0 flex-1 items-center gap-1", !compact && "basis-48")}>
          {uploadImage ? <AttachImageButton disabled={disabled} onFiles={attachments.add} /> : null}
          {chips}
        </div>
        <SendActions canSend={canSend} onSend={() => void submit()} onStop={onStop} />
      </div>
    </fieldset>
  );
};

/**
 * What is typed, and sending it with the images that are uploaded. A send that fails gives the
 * text back with the reason and keeps the images; one that succeeds empties the box.
 */
const useComposerSend = (
  draftId: string,
  send: (text: string, images?: readonly string[]) => Promise<SendResult>,
  attachments: ReturnType<typeof useImageAttachments>,
  disabled: boolean,
) => {
  const [draft, setDraft] = useDraft(draftId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasContent = draft.trim() !== "" || attachments.readyIds.length > 0;
  const canSend = hasContent && attachments.settled && !sending && !disabled;

  const submit = async () => {
    if (!canSend) return;
    const text = draft.trim();
    const images = attachments.readyIds;
    setSending(true);
    setError(null);
    setDraft("");
    const result = await (images.length > 0 ? send(text, images) : send(text));
    setSending(false);
    if (result.ok) {
      attachments.removeSent(images);
      return;
    }
    // Give the text back, unless the person has already started something new.
    setDraft((current) => (current === "" ? text : current));
    setError(result.error);
  };

  return { draft, setDraft, error: error ?? attachments.error, canSend, submit };
};

const ComposerError = ({ error, compact }: { error: string | null; compact: boolean }) =>
  error ? (
    <p
      role="alert"
      data-testid="composer-error"
      className={cn("px-5 pb-1 text-meta text-blocked", compact && "order-last basis-full")}
    >
      {error}
    </p>
  ) : null;

const SendActions = ({
  canSend,
  onSend,
  onStop,
}: {
  canSend: boolean;
  onSend: () => void;
  onStop?: () => void;
}) => (
  <div className="ml-auto flex items-center">
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
      onClick={onSend}
      className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[transform,opacity] duration-150 enabled:hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <ArrowUpIcon aria-hidden="true" className="size-4" strokeWidth={2.25} />
    </button>
  </div>
);
