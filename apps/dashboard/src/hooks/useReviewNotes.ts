import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createReviewNote,
  deleteReviewNote,
  fetchReviewNotes,
  type ReviewNote,
  submitReviewNotes,
  updateReviewNote,
} from "../api/specs-client";

export const useReviewNotes = (repoId: string | undefined, taskId: string | undefined) => {
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!repoId || !taskId) {
      setNotes([]);
      return;
    }

    let cancelled = false;
    void fetchReviewNotes(repoId, taskId)
      .then((nextNotes) => {
        if (!cancelled) setNotes(nextNotes);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });

    return () => {
      cancelled = true;
    };
  }, [repoId, taskId]);

  const pendingNoteCount = useMemo(() => notes.filter((note) => !note.submittedAt).length, [notes]);

  const createNote = useCallback(
    async (input: {
      filePath: string;
      selectedText: string;
      textOccurrence?: number;
      note: string;
    }) => {
      if (!repoId || !taskId) return;
      const note = await createReviewNote(repoId, taskId, input);
      setNotes((current) => [...current, note]);
    },
    [repoId, taskId],
  );

  const updateNote = useCallback(
    async (noteId: string, noteText: string) => {
      if (!repoId || !taskId) return;
      const note = await updateReviewNote(repoId, taskId, noteId, { note: noteText });
      setNotes((current) => current.map((item) => (item.id === noteId ? note : item)));
    },
    [repoId, taskId],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!repoId || !taskId) return;
      await deleteReviewNote(repoId, taskId, noteId);
      setNotes((current) => current.filter((note) => note.id !== noteId));
    },
    [repoId, taskId],
  );

  const submitCorrections = useCallback(async () => {
    if (!repoId || !taskId || pendingNoteCount === 0) return { submittedCount: 0 };

    setSubmitting(true);
    try {
      const result = await submitReviewNotes(repoId, taskId);
      const submittedAt = new Date().toISOString();
      setNotes((current) =>
        current.map((note) =>
          note.submittedAt ? note : { ...note, submittedAt, updatedAt: submittedAt },
        ),
      );
      return result;
    } finally {
      setSubmitting(false);
    }
  }, [pendingNoteCount, repoId, taskId]);

  return {
    notes,
    pendingNoteCount,
    submitting,
    createNote,
    updateNote,
    deleteNote,
    submitCorrections,
  };
};
