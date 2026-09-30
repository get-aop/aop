import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_DESCRIPTION_MAX_LENGTH,
  type MemoryFile,
} from "@aop/common";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Textarea } from "@/ui/textarea";
import { formatUpdated } from "./format";
import { isIndexFile, type MemoryDraft, useMemoryDraft } from "./memory-draft";
import { useMemoryEditor } from "./use-memory-editor";
import type { MemoryFiles } from "./use-memory-files";

/**
 * Edits one memory file, or writes a new topic file when `file` is null. Agents write memory
 * too, so when the file changes on the host under unsaved edits the editor says so and offers
 * the newer version instead of quietly showing or overwriting either.
 */
export const MemoryFileEditor = ({
  file,
  existingNames,
  memory,
  onCreated,
  onClose,
}: {
  file: MemoryFile | null;
  existingNames: readonly string[];
  memory: Pick<MemoryFiles, "save" | "remove">;
  onCreated: (name: string) => void;
  /** The file was deleted, or a new file was cancelled: there is nothing left to edit here. */
  onClose: () => void;
}) => {
  const draft = useMemoryDraft(file);
  const { saving, error, submit, remove } = useMemoryEditor({
    file,
    draft,
    existingNames,
    memory,
    onCreated,
    onDeleted: onClose,
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      data-testid="memory-editor"
      data-name={file?.name ?? ""}
      data-mode={file ? "edit" : "create"}
      className="flex min-w-0 flex-1 flex-col gap-3"
    >
      <EditorHeader file={file} />
      {file ? null : <NameField draft={draft} />}
      {isIndexFile(file) ? <IndexHint /> : <DescriptionField draft={draft} />}
      <BodyField draft={draft} />
      {file && draft.newerOnHost ? <NewerNotice onLoad={() => draft.load(file)} /> : null}
      {error ? (
        <p role="alert" data-testid="memory-error" className="text-[12.5px] text-blocked">
          {error}
        </p>
      ) : null}
      <EditorActions
        file={file}
        draft={draft}
        saving={saving}
        onDiscard={() => (file ? draft.load(file) : onClose())}
        onDelete={() => void remove()}
      />
    </form>
  );
};

const EditorActions = ({
  file,
  draft,
  saving,
  onDiscard,
  onDelete,
}: {
  file: MemoryFile | null;
  draft: MemoryDraft;
  saving: boolean;
  onDiscard: () => void;
  onDelete: () => void;
}) => (
  <div className="flex items-center gap-2">
    {file && !isIndexFile(file) ? <DeleteButton onDelete={onDelete} /> : null}
    <span className="flex-1" />
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="memory-discard"
      disabled={(file !== null && !draft.dirty) || saving}
      onClick={onDiscard}
    >
      {file ? "Discard" : "Cancel"}
    </Button>
    <Button
      type="submit"
      size="sm"
      data-testid="memory-save"
      disabled={!draft.dirty || saving || (file === null && draft.name.trim() === "")}
    >
      {saveLabel(file, saving)}
    </Button>
  </div>
);

const saveLabel = (file: MemoryFile | null, saving: boolean): string => {
  if (saving) return "Saving…";
  return file ? "Save file" : "Create file";
};

const EditorHeader = ({ file }: { file: MemoryFile | null }) => (
  <div className="flex items-baseline gap-2">
    <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">
      {file ? file.name : "New topic file"}
    </h3>
    {file ? (
      <time
        data-testid="memory-editor-updated"
        dateTime={file.updatedAt}
        className="text-[12px] text-text-subtle"
      >
        Updated {formatUpdated(file.updatedAt)}
      </time>
    ) : null}
  </div>
);

const NameField = ({ draft }: { draft: MemoryDraft }) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="memory-new-name">File name</Label>
    <Input
      id="memory-new-name"
      data-testid="memory-new-name"
      autoComplete="off"
      autoFocus
      placeholder="testing.md"
      value={draft.name}
      onChange={(event) => draft.setName(event.target.value)}
    />
  </div>
);

const IndexHint = () => (
  <p className="text-[12.5px] text-text-subtle">
    The index. Every thread reads it whole, so keep it short and point to topic files for detail.
  </p>
);

const DescriptionField = ({ draft }: { draft: MemoryDraft }) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="memory-description">Description</Label>
    <Input
      id="memory-description"
      data-testid="memory-description"
      autoComplete="off"
      maxLength={MEMORY_DESCRIPTION_MAX_LENGTH}
      placeholder="One line on when a thread should read this"
      value={draft.description}
      onChange={(event) => draft.setDescription(event.target.value)}
    />
  </div>
);

const BodyField = ({ draft }: { draft: MemoryDraft }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-baseline gap-2">
      <Label htmlFor="memory-body">Contents</Label>
      <span
        data-testid="memory-body-count"
        className="ml-auto text-[11.5px] tabular-nums text-text-subtle"
      >
        {draft.body.length} / {MEMORY_BODY_MAX_LENGTH}
      </span>
    </div>
    <Textarea
      id="memory-body"
      data-testid="memory-body"
      rows={14}
      maxLength={MEMORY_BODY_MAX_LENGTH}
      value={draft.body}
      onChange={(event) => draft.setBody(event.target.value)}
      className="field-sizing-fixed min-h-0 text-[13px] leading-relaxed"
    />
  </div>
);

const NewerNotice = ({ onLoad }: { onLoad: () => void }) => (
  <div
    role="status"
    data-testid="memory-changed-notice"
    className="flex items-center gap-2 rounded-row border border-waiting/30 bg-waiting/10 px-3 py-2 text-[12.5px] text-text"
  >
    <span className="flex-1">
      This file changed on the host while you were editing. Saving replaces that newer version.
    </span>
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-testid="memory-load-newer"
      onClick={onLoad}
    >
      Load the newer version
    </Button>
  </div>
);

const DeleteButton = ({ onDelete }: { onDelete: () => void }) => (
  <Button
    type="button"
    variant="destructive"
    size="sm"
    data-testid="memory-delete"
    onClick={onDelete}
  >
    Delete file
  </Button>
);
