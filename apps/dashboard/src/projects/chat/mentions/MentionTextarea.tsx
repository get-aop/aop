import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { MentionBackdrop } from "./MentionBackdrop";
import type { useMentions } from "./use-mentions";

/**
 * A composer's textarea with its @-mentions: the box shows each as `@title` over a chip painted
 * behind it, and the keys the open picker takes go to it before `onKeyDown`.
 */
export const MentionTextarea = ({
  mentions,
  input,
  label,
  placeholder,
  disabled,
  compact,
  onKeyDown,
  onPaste,
}: {
  mentions: ReturnType<typeof useMentions>;
  input: RefObject<HTMLTextAreaElement | null>;
  label: string;
  placeholder: string;
  disabled: boolean;
  compact: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}) => {
  const backdrop = useRef<HTMLDivElement>(null);
  // The backdrop lays its text out exactly as the textarea does, or the chips drift off the words.
  const textBox = cn(
    "px-5 text-body",
    compact ? "min-h-[44px] pb-2 pt-2.5" : "min-h-[60px] pb-1 pt-4",
  );
  return (
    <div className={cn("relative", compact && "min-w-0 flex-1")}>
      <MentionBackdrop ref={backdrop} draft={mentions.draft} className={textBox} />
      <textarea
        ref={input}
        data-testid="composer-input"
        value={mentions.draft.text}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        {...mentions.ariaProps}
        onChange={mentions.onChange}
        onSelect={mentions.onSelect}
        onFocus={mentions.onFocus}
        onBlur={mentions.onBlur}
        onKeyDown={(event) => {
          if (!mentions.onKeyDown(event)) onKeyDown(event);
        }}
        onScroll={(event) => {
          if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onPaste={onPaste}
        className={cn(
          "relative block max-h-[220px] w-full resize-none bg-transparent text-text outline-none [field-sizing:content] placeholder:text-text-subtle disabled:cursor-not-allowed",
          textBox,
        )}
      />
    </div>
  );
};
