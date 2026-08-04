import { useEffect, useRef, useState } from "react";
import type { ReviewNote } from "../api/specs-client";
import { MarkdownViewer } from "./MarkdownViewer";

type DraftNote = {
  selectedText: string;
  textOccurrence: number;
  note: string;
  position: SelectionPopoverPosition;
};

export type SelectionPopoverPosition = {
  left: number;
  top: number;
};

export type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPosition: SelectionPopoverPosition;
};

interface AnnotatedMarkdownViewerProps {
  content: string;
  notes: ReviewNote[];
  onCreateNote: (input: {
    selectedText: string;
    textOccurrence?: number;
    note: string;
  }) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onUpdateNote: (noteId: string, note: string) => Promise<void>;
}

export const AnnotatedMarkdownViewer = ({
  content,
  notes,
  onCreateNote,
  onDeleteNote,
  onUpdateNote,
}: AnnotatedMarkdownViewerProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectedTextOccurrence, setSelectedTextOccurrence] = useState(0);
  const [selectedPosition, setSelectedPosition] = useState<SelectionPopoverPosition | null>(null);
  const [draft, setDraft] = useState<DraftNote | null>(null);
  const [activeNote, setActiveNote] = useState<ReviewNote | null>(null);
  const [activeNotePosition, setActiveNotePosition] = useState<SelectionPopoverPosition | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const renderedMarkdownKey = buildRenderedMarkdownKey(content, notes);

  useEffect(() => {
    applyHighlights(rootRef.current, notes, (note, position) => {
      setActiveNote(note);
      setActiveNotePosition(position);
    });
  }, [notes]);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    const nextSelectedText = selection?.toString().trim() ?? "";
    if (!nextSelectedText) {
      if (!draft) {
        setSelectedText(null);
        setSelectedTextOccurrence(0);
        setSelectedPosition(null);
      }
      return;
    }

    setSelectedText(nextSelectedText);
    setSelectedTextOccurrence(
      resolveSelectionTextOccurrence(rootRef.current, selection, nextSelectedText),
    );
    setSelectedPosition(resolveSelectionPosition(selection));
  };

  const saveDraft = async () => {
    if (!draft?.note.trim()) return;

    setSaving(true);
    await onCreateNote({
      selectedText: draft.selectedText,
      ...(draft.textOccurrence ? { textOccurrence: draft.textOccurrence } : {}),
      note: draft.note.trim(),
    });
    window.getSelection()?.removeAllRanges();
    setDraft(null);
    setSelectedText(null);
    setSelectedTextOccurrence(0);
    setSelectedPosition(null);
    setSaving(false);
  };

  const updateActiveNote = async () => {
    if (!activeNote?.note.trim()) return;

    setSaving(true);
    await onUpdateNote(activeNote.id, activeNote.note.trim());
    setActiveNote(null);
    setActiveNotePosition(null);
    setSaving(false);
  };

  const deleteActiveNote = async () => {
    if (!activeNote) return;

    setSaving(true);
    await onDeleteNote(activeNote.id);
    setActiveNote(null);
    setActiveNotePosition(null);
    setSaving(false);
  };

  return (
    <section
      aria-label="Annotated markdown"
      className="relative"
      data-testid="annotated-markdown-viewer"
      onMouseUp={handleMouseUp}
    >
      <div key={renderedMarkdownKey} ref={rootRef}>
        <MarkdownViewer content={content} />
      </div>

      {selectedText && selectedPosition && !draft ? (
        <SelectionToolbar
          position={selectedPosition}
          onAddNote={() => {
            const editorPosition = resolveEditorPosition(window.getSelection());
            setDraft({
              selectedText,
              textOccurrence: selectedTextOccurrence,
              note: "",
              position: editorPosition,
            });
          }}
          onClose={() => {
            window.getSelection()?.removeAllRanges();
            setSelectedText(null);
            setSelectedTextOccurrence(0);
            setSelectedPosition(null);
          }}
        />
      ) : null}

      {draft ? (
        <ReviewNoteEditor
          title="Add note"
          note={draft.note}
          position={draft.position}
          saving={saving}
          onChange={(note) => setDraft({ ...draft, note })}
          onCancel={() => {
            setDraft(null);
            setSelectedText(null);
            setSelectedTextOccurrence(0);
            setSelectedPosition(null);
          }}
          onSave={saveDraft}
        />
      ) : null}

      {activeNote && activeNotePosition ? (
        <ReviewNoteEditor
          title="Edit note"
          note={activeNote.note}
          position={activeNotePosition}
          saving={saving}
          onChange={(note) => setActiveNote({ ...activeNote, note })}
          onCancel={() => {
            setActiveNote(null);
            setActiveNotePosition(null);
          }}
          onDelete={deleteActiveNote}
          onSave={updateActiveNote}
        />
      ) : null}
    </section>
  );
};

import {
  applyHighlights,
  buildRenderedMarkdownKey,
  ReviewNoteEditor,
  resolveEditorPosition,
  resolveSelectionPosition,
  resolveSelectionTextOccurrence,
  SelectionToolbar,
} from "./annotation-layer";
