import { createContext, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Textarea } from "@/ui/textarea";
import type { SessionDiffLine } from "../../api/client";

export interface DiffReviewContextValue {
  commentedKeys: Set<string>;
  addComment: (path: string, line: SessionDiffLine, note: string) => void;
}

/** Lets deeply nested diff rows reach the review queue without prop threading. */
export const DiffReviewContext = createContext<DiffReviewContextValue | null>(null);

export const diffLineCommentKey = (
  path: string,
  line: Pick<SessionDiffLine, "type" | "oldNo" | "newNo">,
): string => `${path}:${line.type}:${line.oldNo ?? ""}:${line.newNo ?? ""}`;

const EXCERPT_MAX_LENGTH = 200;

/** Single-line, trailing-whitespace-trimmed excerpt capped for queue cards and messages. */
export const diffLineExcerpt = (text: string): string =>
  (text.split("\n")[0] ?? "").replace(/\s+$/, "").slice(0, EXCERPT_MAX_LENGTH);

export const DiffLineCommentEditor = ({
  initialNote = "",
  saveLabel = "Add",
  onSave,
  onCancel,
}: {
  initialNote?: string;
  saveLabel?: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}) => {
  const [note, setNote] = useState(initialNote);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  const trimmed = note.trim();
  const save = () => {
    if (trimmed) onSave(trimmed);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };
  return (
    <div data-testid="diff-comment-editor" className="border-y border-border bg-raised px-3 py-2">
      <Textarea
        ref={textareaRef}
        value={note}
        rows={2}
        placeholder="Leave a review comment"
        aria-label="Review comment"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-0 resize-none p-2 text-[11.5px]"
      />
      <div className="mt-1.5 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!trimmed} onClick={save}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
};
