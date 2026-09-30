import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_INDEX_NAME,
  type MemoryFile,
  type MemoryFileInput,
} from "@aop/common";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { messageOf } from "./errors";

const INDEX_DESCRIPTION = "What the project's sessions need to know first.";

type Feedback = { tone: "ok" | "error"; text: string };

/**
 * Adds one line to the MEMORY.md index, which every thread reads, without opening an editor.
 * The line goes below what the index already says; a project with no index gets one.
 */
export const QuickNote = ({
  files,
  onSave,
}: {
  files: readonly MemoryFile[];
  onSave: (input: MemoryFileInput) => Promise<unknown>;
}) => {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const line = note.replace(/\s+/g, " ").trim();
    if (!line) return;
    const input = withNote(files, line);
    if (!input) {
      setFeedback({
        tone: "error",
        text: `${MEMORY_INDEX_NAME} is full. Move some of it into a topic file first.`,
      });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await onSave(input);
      setNote("");
      setFeedback({ tone: "ok", text: `Added to ${MEMORY_INDEX_NAME}.` });
    } catch (cause) {
      setFeedback({ tone: "error", text: messageOf(cause, "Could not save the note") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      data-testid="memory-quick-note"
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2">
        <Input
          data-testid="memory-quick-note-input"
          aria-label="Quick note"
          autoComplete="off"
          placeholder="Note something every thread should know…"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setFeedback(null);
          }}
          className="h-8 text-[13px]"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          data-testid="memory-quick-note-add"
          disabled={saving || note.trim() === ""}
        >
          Add note
        </Button>
      </div>
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          data-testid="memory-quick-note-message"
          className={feedback.tone === "error" ? "text-[12px] text-blocked" : "text-[12px] text-ok"}
        >
          {feedback.text}
        </p>
      ) : null}
    </form>
  );
};

/** The index with `line` appended as a bullet, or null when the index would outgrow the limit. */
const withNote = (files: readonly MemoryFile[], line: string): MemoryFileInput | null => {
  const index = files.find((file) => file.name === MEMORY_INDEX_NAME);
  const existing = index?.body.trimEnd() ?? "";
  const body = `${existing}${existing ? "\n" : ""}- ${line}\n`;
  if (body.length > MEMORY_BODY_MAX_LENGTH) return null;
  return { name: MEMORY_INDEX_NAME, description: index?.description || INDEX_DESCRIPTION, body };
};
