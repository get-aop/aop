import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";

const FOLDED_MAX_CHARS = 600;
const FOLDED_MAX_LINES = 8;

/** Whether a message's text is long enough to open folded. */
export const isLong = (text: string): boolean =>
  text.length > FOLDED_MAX_CHARS || text.split("\n").length > FOLDED_MAX_LINES;

/**
 * A long message opens folded: its first lines, fading out, and a button that shows the rest.
 * `text` decides whether it is long; `children` is how it is drawn.
 */
export const Folded = ({
  text,
  more = "Show full message",
  children,
}: {
  text: string;
  /** What the button that unfolds it says. */
  more?: string;
  children: ReactNode;
}) => {
  const [expanded, setExpanded] = useState(false);
  const foldable = isLong(text);
  const folded = foldable && !expanded;
  return (
    <>
      <div
        data-user-message-collapsed={folded ? "true" : "false"}
        className={cn("relative", folded && "max-h-44 overflow-hidden")}
        style={
          folded
            ? {
                maskImage: "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)",
              }
            : undefined
        }
      >
        {children}
      </div>
      {foldable ? (
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="user-message-fold"
          onClick={() => setExpanded((value) => !value)}
          className="-ml-1 mt-1.5 h-7 rounded-md px-1.5 text-meta text-text-subtle hover:bg-hover hover:text-text-muted"
        >
          {expanded ? "Show less" : more}
        </button>
      ) : null}
    </>
  );
};
