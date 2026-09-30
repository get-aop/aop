import {
  MEMORY_INDEX_NAME,
  type MemoryFile,
  type MemoryFileInput,
  MemoryFileInputSchema,
} from "@aop/common";
import { useCallback, useEffect, useState } from "react";

export interface MemoryDraft {
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (description: string) => void;
  body: string;
  setBody: (body: string) => void;
  dirty: boolean;
  /** The host's copy moved past the version these edits started from: someone else saved. */
  newerOnHost: boolean;
  /** Replaces the edits with `version`, which becomes the version they start from. */
  load: (version: MemoryFile) => void;
}

/**
 * The edits to one memory file, or the fields of a file being created (`file` null). While the
 * person has no edits the draft follows the host's copy; once they do, it stays put and reports
 * that a newer copy exists, so nothing is replaced under their hands.
 */
export const useMemoryDraft = (file: MemoryFile | null): MemoryDraft => {
  const [base, setBase] = useState<MemoryFile | null>(file);
  const [name, setName] = useState("");
  const [description, setDescription] = useState(file?.description ?? "");
  const [body, setBody] = useState(file?.body ?? "");

  const dirty = base
    ? description !== base.description || body !== base.body
    : name !== "" || description !== "" || body !== "";
  const newerOnHost = file !== null && base !== null && file.updatedAt !== base.updatedAt;

  const load = useCallback((version: MemoryFile) => {
    setBase(version);
    setDescription(version.description);
    setBody(version.body);
  }, []);

  useEffect(() => {
    if (file && newerOnHost && !dirty) load(file);
  }, [file, newerOnHost, dirty, load]);

  return { name, setName, description, setDescription, body, setBody, dirty, newerOnHost, load };
};

/** The file a draft would save: a new file's name gets `.md` if it lacks it. */
export const draftInput = (file: MemoryFile | null, draft: MemoryDraft): MemoryFileInput => ({
  name: file?.name ?? withMarkdownExtension(draft.name),
  description: draft.description,
  body: draft.body,
});

/** Why a draft cannot be saved, or null. Creating must not silently replace a file that exists. */
export const refusalOf = (
  input: MemoryFileInput,
  creating: boolean,
  existingNames: readonly string[],
): string | null => {
  const parsed = MemoryFileInputSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Check the fields and try again";
  return creating && existingNames.includes(input.name)
    ? `${input.name} already exists. Pick another name, or open it from the list.`
    : null;
};

export const isIndexFile = (file: MemoryFile | null): boolean => file?.name === MEMORY_INDEX_NAME;

const withMarkdownExtension = (name: string): string => {
  const trimmed = name.trim();
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
};
