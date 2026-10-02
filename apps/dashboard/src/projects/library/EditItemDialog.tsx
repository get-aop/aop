import { type LibraryItem, normalizeLibraryFolder, normalizeLibraryName } from "@aop/common";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";

export type EditMode = "rename" | "move";

const COPY: Record<EditMode, { title: string; label: string; action: string }> = {
  rename: { title: "Rename file", label: "Name", action: "Rename" },
  move: { title: "Move file", label: "Folder", action: "Move" },
};

/**
 * Renames an item or moves it to another folder. A folder is a path such as `Reports/Q3`; one
 * that does not exist yet is made by moving a file into it, and an empty path is the top level.
 */
export const EditItemDialog = ({
  edit,
  folders,
  onClose,
  onSave,
}: {
  edit: { item: LibraryItem; mode: EditMode } | null;
  folders: readonly string[];
  onClose: () => void;
  /** Resolves true when the host took the change. */
  onSave: (item: LibraryItem, patch: { name: string } | { folder: string }) => Promise<boolean>;
}) => {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const listId = useId();

  useEffect(() => {
    if (edit) setValue(edit.mode === "rename" ? edit.item.name : edit.item.folder);
  }, [edit]);

  if (!edit) return null;
  const copy = COPY[edit.mode];
  const problem = problemOf(edit.mode, value);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    setSaving(true);
    const saved = await onSave(edit.item, patchOf(edit.mode, value));
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        data-testid={`library-${edit.mode}-dialog`}
        className="w-[min(440px,calc(100vw-2rem))]"
      >
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{copy.title}</DialogTitle>
            <DialogDescription className="truncate">{edit.item.name}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-meta font-medium text-text">
              {copy.label}
            </label>
            <Input
              id={inputId}
              data-testid="library-edit-input"
              value={value}
              autoFocus
              list={edit.mode === "move" ? listId : undefined}
              placeholder={edit.mode === "move" ? "Top level of the Library" : undefined}
              aria-invalid={problem !== null}
              onChange={(event) => setValue(event.target.value)}
            />
            {edit.mode === "move" ? (
              <datalist id={listId}>
                {folders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
            ) : null}
            {problem ? (
              <p role="alert" data-testid="library-edit-problem" className="text-meta text-blocked">
                {problem}
              </p>
            ) : edit.mode === "move" ? (
              <p className="text-meta text-text-subtle">
                Type a new folder name to make one; leave it empty for the top level.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="library-edit-save"
              disabled={problem !== null || saving}
            >
              {copy.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const problemOf = (mode: EditMode, value: string): string | null => {
  if (mode === "rename") {
    return normalizeLibraryName(value) === null
      ? "Use 1 to 200 characters, without / or \\."
      : null;
  }
  return normalizeLibraryFolder(value) === null
    ? "Use at most 4 folder levels, separated by /."
    : null;
};

const patchOf = (mode: EditMode, value: string): { name: string } | { folder: string } =>
  mode === "rename"
    ? { name: normalizeLibraryName(value) ?? value }
    : { folder: normalizeLibraryFolder(value) ?? value };
