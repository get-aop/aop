import { MEMORY_INDEX_NAME, type MemoryFile } from "@aop/common";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { SettingsBlock } from "./blocks";
import { formatUpdated } from "./format";
import { MemoryFileEditor } from "./MemoryFileEditor";
import { QuickNote } from "./QuickNote";
import { type MemoryFiles, useMemoryFiles } from "./use-memory-files";

/** "new" is the editor for a topic file that does not exist yet. */
type Selection = string | "new" | null;

/**
 * The notes agents write themselves and the person can edit: the MEMORY.md index that every
 * thread reads, and topic files read when a thread needs them.
 */
export const AutoMemory = ({ projectId }: { projectId: string }) => {
  const memory = useMemoryFiles(projectId);

  return (
    <SettingsBlock
      title="Auto memory"
      description="Notes Claude writes itself as the project goes. Edit them, add your own, or delete what has gone stale: stale memory misleads every thread."
      testId="settings-auto-memory"
    >
      <QuickNote files={memory.files ?? []} onSave={memory.save} />
      {memory.error ? (
        <p role="alert" data-testid="memory-load-error" className="text-[12.5px] text-blocked">
          {memory.error}
        </p>
      ) : null}
      {memory.files === null ? (
        <p data-testid="memory-loading" className="text-[12.5px] text-text-subtle">
          Loading memory…
        </p>
      ) : (
        <MemoryBrowser files={memory.files} memory={memory} />
      )}
    </SettingsBlock>
  );
};

const MemoryBrowser = ({
  files,
  memory,
}: {
  files: readonly MemoryFile[];
  memory: MemoryFiles;
}) => {
  const [picked, setPicked] = useState<Selection>(null);
  // Until the person picks one, the index is open: it is the file every thread reads.
  const selection = picked ?? files.find(isIndex)?.name ?? null;

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <MemoryFileList
        files={files}
        selection={selection}
        onSelect={setPicked}
        onNew={() => setPicked("new")}
      />
      <EditorPane
        files={files}
        selection={selection}
        memory={memory}
        onCreated={setPicked}
        onClose={() => setPicked(null)}
      />
    </div>
  );
};

const EditorPane = ({
  files,
  selection,
  memory,
  onCreated,
  onClose,
}: {
  files: readonly MemoryFile[];
  selection: Selection;
  memory: MemoryFiles;
  onCreated: (name: string) => void;
  onClose: () => void;
}) => {
  const file = files.find((candidate) => candidate.name === selection) ?? null;
  if (selection !== "new" && !file) return <MemoryEmpty hasFiles={files.length > 0} />;
  return (
    <MemoryFileEditor
      key={file?.name ?? "new"}
      file={file}
      existingNames={files.map((candidate) => candidate.name)}
      memory={memory}
      onCreated={onCreated}
      onClose={onClose}
    />
  );
};

const isIndex = (file: MemoryFile): boolean => file.name === MEMORY_INDEX_NAME;

const MemoryFileList = ({
  files,
  selection,
  onSelect,
  onNew,
}: {
  files: readonly MemoryFile[];
  selection: Selection;
  onSelect: (name: string) => void;
  onNew: () => void;
}) => (
  <div className="flex w-full shrink-0 flex-col gap-2 md:w-64">
    <ul data-testid="memory-files" className="flex flex-col gap-1">
      {files.map((file) => (
        <li key={file.name}>
          <MemoryFileRow
            file={file}
            selected={selection === file.name}
            onSelect={() => onSelect(file.name)}
          />
        </li>
      ))}
    </ul>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="memory-new"
      onClick={onNew}
      className="self-start"
    >
      <PlusIcon />
      New topic file
    </Button>
  </div>
);

const MemoryFileRow = ({
  file,
  selected,
  onSelect,
}: {
  file: MemoryFile;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    data-testid="memory-file"
    data-name={file.name}
    aria-current={selected ? "true" : undefined}
    onClick={onSelect}
    className={cn(
      "flex w-full flex-col gap-0.5 rounded-row border px-3 py-2 text-left transition-colors duration-[120ms]",
      selected ? "border-border-bold bg-raised" : "border-border hover:bg-hover",
    )}
  >
    <span className="flex items-center gap-2">
      <span data-testid="memory-file-name" className="truncate text-[13px] text-text">
        {file.name}
      </span>
      {isIndex(file) ? (
        <span
          data-testid="memory-index-label"
          className="shrink-0 rounded-md border border-border-strong px-1.5 text-[11px] text-text-muted"
        >
          read every thread
        </span>
      ) : null}
    </span>
    {file.description ? (
      <span
        data-testid="memory-file-description"
        className="line-clamp-2 text-[12px] text-text-muted"
      >
        {file.description}
      </span>
    ) : null}
    <time
      data-testid="memory-file-updated"
      dateTime={file.updatedAt}
      className="text-[11.5px] text-text-subtle"
    >
      Updated {formatUpdated(file.updatedAt)}
    </time>
  </button>
);

const MemoryEmpty = ({ hasFiles }: { hasFiles: boolean }) => (
  <div
    data-testid="memory-empty"
    className="flex min-h-40 flex-1 flex-col items-center justify-center gap-1 rounded-row border border-dashed border-border px-6 py-8 text-center"
  >
    <h3 className="text-[13px] font-medium text-text">
      {hasFiles ? "Pick a file to edit" : "No memory yet"}
    </h3>
    <p className="max-w-sm text-[12.5px] text-text-subtle">
      {hasFiles
        ? "Choose a file on the left, or add a topic file."
        : "The coordinator and threads save what later work will need, such as decisions and where things live. Add a note above to start it yourself."}
    </p>
  </div>
);
