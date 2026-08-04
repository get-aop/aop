import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/ui/button";
import type { ReviewNote } from "../api/specs-client";
import type { DragState, SelectionPopoverPosition } from "./AnnotatedMarkdownViewer";

export const SelectionToolbar = ({
  position,
  onAddNote,
  onClose,
}: {
  position: SelectionPopoverPosition;
  onAddNote: () => void;
  onClose: () => void;
}) => (
  <div
    className="fixed z-[var(--z-menu)] flex items-center gap-1 rounded-card border border-border bg-surface p-1 shadow-2"
    style={{ left: position.left, top: position.top }}
  >
    <button
      type="button"
      aria-label="Add note"
      className="focus-ring flex h-7 w-7 cursor-pointer items-center justify-center rounded-control bg-action text-on-action transition duration-200 hover:bg-action-hover"
      onClick={onAddNote}
    >
      <PlusIcon className="size-4" strokeWidth={1.7} />
    </button>
    <button
      type="button"
      className="focus-ring flex h-6 w-6 cursor-pointer items-center justify-center rounded-control text-text-muted transition duration-200 hover:bg-raised hover:text-text"
      onClick={onClose}
      aria-label="Close selection tools"
    >
      <XIcon className="size-3.5" strokeWidth={1.7} />
    </button>
  </div>
);

export const ReviewNoteEditor = ({
  note,
  position,
  saving,
  title,
  onCancel,
  onChange,
  onDelete,
  onSave,
}: {
  note: string;
  position: SelectionPopoverPosition;
  saving: boolean;
  title: string;
  onCancel: () => void;
  onChange: (note: string) => void;
  onDelete?: () => void;
  onSave: () => void;
}) => {
  const [editorPosition, setEditorPosition] = useState(position);
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    setEditorPosition(position);
  }, [position]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;

      setEditorPosition(
        clampEditorPosition({
          left: dragState.startPosition.left + event.clientX - dragState.startX,
          top: dragState.startPosition.top + event.clientY - dragState.startY,
        }),
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === dragState.pointerId) setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: editorPosition,
    });
  };

  return (
    <div
      className="fixed z-[var(--z-menu)] w-[min(34rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-4 shadow-3"
      data-testid="review-note-editor"
      style={{ left: editorPosition.left, top: editorPosition.top }}
    >
      <div
        className="mb-2 flex cursor-move touch-none items-center justify-between gap-3"
        data-testid="review-note-drag-handle"
        onPointerDown={startDrag}
      >
        <span className="text-[11px] text-text-muted">{title}</span>
        <button
          type="button"
          className="focus-ring cursor-pointer rounded-control text-[13px] font-medium text-text-muted transition duration-200 hover:text-text"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      <label className="text-[11px] grid gap-1.5 text-text-muted">
        Reviewer note
        <textarea
          className="focus-ring min-h-24 resize-y rounded-control border border-border bg-raised p-2.5 text-sm normal-case tracking-normal text-text"
          value={note}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {onDelete ? (
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={saving}>
            Delete note
          </Button>
        ) : null}
        <Button size="sm" onClick={onSave} disabled={saving || !note.trim()}>
          Save note
        </Button>
      </div>
    </div>
  );
};

const DEFAULT_POPOVER_POSITION: SelectionPopoverPosition = {
  left: 16,
  top: 16,
};

export const TOOLBAR_OFFSET_PX = 48;

export const resolveSelectionRect = (selection: Selection | null): DOMRect | null => {
  if (!selection || selection.rangeCount === 0) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return rect;
};

export const resolveSelectionPosition = (selection: Selection | null): SelectionPopoverPosition => {
  const rect = resolveSelectionRect(selection);
  if (!rect) return DEFAULT_POPOVER_POSITION;

  return clampPopoverPosition({
    left: rect.left,
    top: rect.top - TOOLBAR_OFFSET_PX,
  });
};

export const EDITOR_HEIGHT_ESTIMATE_PX = 220;

export const resolveEditorPosition = (selection: Selection | null): SelectionPopoverPosition => {
  const rect = resolveSelectionRect(selection);
  if (!rect) return DEFAULT_POPOVER_POSITION;

  const belowTop = rect.bottom + 12;
  const fitsBelow = belowTop + EDITOR_HEIGHT_ESTIMATE_PX <= window.innerHeight - 8;
  return clampEditorPosition({
    left: rect.left,
    top: fitsBelow ? belowTop : rect.top - EDITOR_HEIGHT_ESTIMATE_PX - 12,
  });
};

export const resolveSelectionTextOccurrence = (
  root: HTMLElement | null,
  selection: Selection | null,
  selectedText: string,
): number => {
  if (!root || !selection || selection.rangeCount === 0 || !selectedText) return 0;

  const spans = collectTextNodeSpans(root);
  const startOffset = resolveRangeStartOffset(root, selection.getRangeAt(0), spans);
  if (startOffset === null) return 0;

  const fullText = spans.map((span) => span.node.nodeValue ?? "").join("");
  let occurrence = 0;
  let searchStart = 0;

  while (searchStart < fullText.length) {
    const nextStart = fullText.indexOf(selectedText, searchStart);
    if (nextStart === -1 || nextStart >= startOffset) return occurrence;

    occurrence += 1;
    searchStart = nextStart + selectedText.length;
  }

  return 0;
};

export const clampPopoverPosition = (
  position: SelectionPopoverPosition,
): SelectionPopoverPosition => ({
  left: Math.max(8, Math.min(position.left, window.innerWidth - 240)),
  top: Math.max(8, Math.min(position.top, window.innerHeight - 160)),
});

export const clampEditorPosition = (
  position: SelectionPopoverPosition,
): SelectionPopoverPosition => ({
  left: Math.max(8, Math.min(position.left, window.innerWidth - 360)),
  top: Math.max(8, Math.min(position.top, window.innerHeight - 220)),
});

export const applyHighlights = (
  root: HTMLDivElement | null,
  notes: ReviewNote[],
  onOpenNote: (note: ReviewNote, position: SelectionPopoverPosition) => void,
): void => {
  if (!root) return;

  for (const note of notes) {
    if (root.querySelector(`[data-review-note-id="${note.id}"]`)) continue;

    const range = findTextRange(root, note.selectedText, note.textOccurrence);
    if (!range) continue;

    const highlight = document.createElement("mark");
    highlight.className = "rounded bg-favorite/20 px-0.5 text-text";
    highlight.dataset.reviewNoteId = note.id;
    highlight.dataset.testid = `annotation-highlight-${note.id}`;
    highlight.append(range.extractContents());
    range.insertNode(highlight);

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "focus-ring ml-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-pill border border-favorite/60 bg-surface align-middle text-[11.5px] text-favorite";
    button.textContent = "!";
    button.setAttribute("aria-label", `Open note for ${note.filePath}`);
    button.addEventListener("click", () => {
      const rect = button.getBoundingClientRect();
      onOpenNote(
        note,
        clampEditorPosition({
          left: rect.left,
          top: rect.bottom + 8,
        }),
      );
    });
    highlight.after(button);
  }
};

interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

export const findTextRange = (
  root: HTMLElement,
  text: string,
  textOccurrence: number | undefined,
): Range | null => {
  const spans = collectTextNodeSpans(root);
  const fullText = spans.map((span) => span.node.nodeValue ?? "").join("");
  const start = findTextOccurrenceStart(fullText, text, textOccurrence);
  if (start === -1) return null;

  const end = start + text.length;
  const startBoundary = findTextBoundary(spans, start, "start");
  const endBoundary = findTextBoundary(spans, end, "end");
  if (!startBoundary || !endBoundary) return null;

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  return range;
};

const findTextOccurrenceStart = (
  fullText: string,
  text: string,
  textOccurrence: number | undefined,
): number => {
  if (!text) return -1;

  const requestedOccurrence = normalizeTextOccurrence(textOccurrence);
  let searchStart = 0;

  for (let index = 0; index <= requestedOccurrence; index += 1) {
    const matchStart = fullText.indexOf(text, searchStart);
    if (matchStart === -1) break;
    if (index === requestedOccurrence) return matchStart;
    searchStart = matchStart + text.length;
  }

  return requestedOccurrence > 0 ? fullText.indexOf(text) : -1;
};

export const collectTextNodeSpans = (root: HTMLElement): TextNodeSpan[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const spans: TextNodeSpan[] = [];
  let offset = 0;
  let node = walker.nextNode();

  while (node) {
    const text = node.nodeValue ?? "";
    spans.push({ node: node as Text, start: offset, end: offset + text.length });
    offset += text.length;
    node = walker.nextNode();
  }

  return spans;
};

export const resolveRangeStartOffset = (
  root: HTMLElement,
  range: Range,
  spans: TextNodeSpan[],
): number | null => {
  if (!root.contains(range.startContainer)) return null;

  for (const span of spans) {
    if (span.node === range.startContainer) {
      return span.start + range.startOffset;
    }
  }

  try {
    const beforeSelection = document.createRange();
    beforeSelection.selectNodeContents(root);
    beforeSelection.setEnd(range.startContainer, range.startOffset);
    return beforeSelection.toString().length;
  } catch {
    return null;
  }
};

const normalizeTextOccurrence = (textOccurrence: number | undefined): number => {
  if (
    typeof textOccurrence !== "number" ||
    !Number.isInteger(textOccurrence) ||
    textOccurrence < 0
  ) {
    return 0;
  }
  return textOccurrence;
};

const findTextBoundary = (
  spans: TextNodeSpan[],
  offset: number,
  boundary: "start" | "end",
): { node: Text; offset: number } | null => {
  for (const span of spans) {
    if (offset < span.start || offset > span.end) continue;
    if (offset === span.end && boundary === "start") continue;
    return { node: span.node, offset: offset - span.start };
  }

  const lastSpan = spans.at(-1);
  if (lastSpan && offset === lastSpan.end) {
    return { node: lastSpan.node, offset: lastSpan.node.nodeValue?.length ?? 0 };
  }

  return null;
};

export const buildRenderedMarkdownKey = (content: string, notes: ReviewNote[]): string =>
  JSON.stringify({
    content,
    notes: notes.map((note) => [note.id, note.updatedAt, note.submittedAt ?? null]),
  });
