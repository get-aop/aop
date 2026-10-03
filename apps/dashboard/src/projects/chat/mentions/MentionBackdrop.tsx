import type { ReactNode } from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import type { MentionDraft } from "./mention-markup";

/**
 * Drawn behind a composer's textarea, with the same box and the same text in it, invisible but for
 * the chip under each mention's `@title`: a textarea cannot style part of its text, so the chips
 * are painted under it. `className` must lay text out exactly as the textarea does (padding,
 * size); the textarea's scroll is mirrored through the ref.
 */
export const MentionBackdrop = forwardRef<
  HTMLDivElement,
  { draft: MentionDraft; className: string }
>(function MentionBackdrop({ draft, className }, ref) {
  if (draft.mentions.length === 0) return null;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const mention of draft.mentions) {
    parts.push(draft.text.slice(at, mention.start));
    parts.push(
      <mark
        key={mention.start}
        data-testid="composer-mention"
        data-thread-id={mention.threadId}
        className="rounded-[4px] bg-running/15 text-transparent shadow-[0_0_0_1.5px] shadow-running/35"
      >
        {draft.text.slice(mention.start, mention.end)}
      </mark>,
    );
    at = mention.end;
  }
  // A trailing line break would collapse here but not in the textarea: keep the line.
  parts.push(`${draft.text.slice(at)}​`);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="composer-mention-backdrop"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent",
        className,
      )}
    >
      {parts}
    </div>
  );
});
