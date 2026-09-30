import type { MemoryFile } from "@aop/common";
import { type FormEvent, useState } from "react";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { messageOf } from "./errors";
import { draftInput, type MemoryDraft, refusalOf } from "./memory-draft";
import type { MemoryFiles } from "./use-memory-files";

interface MemoryEditorInput {
  file: MemoryFile | null;
  draft: MemoryDraft;
  existingNames: readonly string[];
  memory: Pick<MemoryFiles, "save" | "remove">;
  onCreated: (name: string) => void;
  /** The file was deleted: there is nothing left to edit here. */
  onDeleted: () => void;
}

/** Saving and deleting for the editor, with the reason either one failed. */
export const useMemoryEditor = ({
  file,
  draft,
  existingNames,
  memory,
  onCreated,
  onDeleted,
}: MemoryEditorInput) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = draftInput(file, draft);
    const refusal = refusalOf(input, file === null, existingNames);
    if (refusal) {
      setError(refusal);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await memory.save(input);
      if (file) draft.load(saved);
      else onCreated(saved.name);
    } catch (cause) {
      setError(messageOf(cause, "Could not save the file"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!file) return;
    const confirmed = await requestConfirmation({
      title: `Delete ${file.name}?`,
      message: "Threads stop seeing this file. It cannot be recovered.",
      confirmLabel: "Delete file",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await memory.remove(file.name);
      onDeleted();
    } catch (cause) {
      setError(messageOf(cause, "Could not delete the file"));
    }
  };

  return { saving, error, submit, remove };
};
