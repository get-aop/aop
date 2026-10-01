import { MEMORY_INDEX_NAME, type MemoryFile } from "@aop/common";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { formatAgo } from "../selectors";
import { useNow } from "../use-now";
import { SettingsBlock } from "./blocks";
import { formatUpdated } from "./format";
import { MemoryFileEditor } from "./MemoryFileEditor";
import type { MemoryFiles } from "./use-memory-files";

/** "new" is the editor for a topic file that does not exist yet. */
type Opened = string | "new" | null;

/**
 * The notes agents write themselves: the MEMORY.md index that every thread reads, then topic files
 * read when a thread needs them. The list comes first; a file opens in an editor in its place.
 */
export const AutoMemory = ({ memory }: { memory: MemoryFiles }) => {
  const [opened, setOpened] = useState<Opened>(null);
  const files = memory.files;
  // A file the coordinator deleted while it was open has nothing left to show.
  const file = files?.find((candidate) => candidate.name === opened) ?? null;
  const editing = files !== null && (opened === "new" || file !== null);

  return (
    <SettingsBlock
      title="Auto memory"
      description="Notes Claude writes itself as it works in this project. Stale memory misleads every thread, so ask below for what to change or remove, or open a file to edit it."
      testId="settings-auto-memory"
    >
      {memory.error ? (
        <p role="alert" data-testid="memory-load-error" className="text-[12.5px] text-blocked">
          {memory.error}
        </p>
      ) : null}
      {files === null ? (
        <p data-testid="memory-loading" className="text-[12.5px] text-text-subtle">
          Loading memory…
        </p>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="memory-back"
            onClick={() => setOpened(null)}
            className="-ml-2 self-start"
          >
            <ArrowLeftIcon />
            All memory
          </Button>
          <MemoryFileEditor
            key={file?.name ?? "new"}
            file={file}
            existingNames={(files ?? []).map((candidate) => candidate.name)}
            memory={memory}
            onCreated={setOpened}
            onClose={() => setOpened(null)}
          />
        </div>
      ) : null}
      {files !== null && !editing ? (
        <MemoryList files={files} onOpen={setOpened} onNew={() => setOpened("new")} />
      ) : null}
    </SettingsBlock>
  );
};

const isIndex = (file: MemoryFile): boolean => file.name === MEMORY_INDEX_NAME;

const MemoryList = ({
  files,
  onOpen,
  onNew,
}: {
  files: readonly MemoryFile[];
  onOpen: (name: string) => void;
  onNew: () => void;
}) => {
  const now = useNow();
  const index = files.find(isIndex);
  const topics = files.filter((file) => !isIndex(file));

  return (
    <div data-testid="memory-files" className="flex flex-col gap-5">
      <MemoryGroup testId="memory-index-group" title="Read every thread">
        {index ? (
          <MemoryRow file={index} now={now} onOpen={() => onOpen(index.name)} />
        ) : (
          <MemoryNone testId="memory-index-empty">
            No {MEMORY_INDEX_NAME} yet. Claude starts it once it learns something every thread
            should know.
          </MemoryNone>
        )}
      </MemoryGroup>
      <MemoryGroup
        testId="memory-topic-group"
        title="Memory files"
        action={
          <Button type="button" variant="ghost" size="xs" data-testid="memory-new" onClick={onNew}>
            <PlusIcon />
            New topic file
          </Button>
        }
      >
        {topics.length > 0 ? (
          topics.map((file) => (
            <MemoryRow key={file.name} file={file} now={now} onOpen={() => onOpen(file.name)} />
          ))
        ) : (
          <MemoryNone testId="memory-topics-empty">
            No topic files yet. Threads read these only when their subject comes up.
          </MemoryNone>
        )}
      </MemoryGroup>
    </div>
  );
};

const MemoryGroup = ({
  testId,
  title,
  action,
  children,
}: {
  testId: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section data-testid={testId} className="flex flex-col">
    <div className="flex min-h-7 items-center gap-2 pb-2">
      <h3 className="flex-1 text-[13.5px] font-medium text-text">{title}</h3>
      {action}
    </div>
    <ul className="flex flex-col border-t border-border">{children}</ul>
  </section>
);

/** One file: its name (the way in), what it is about, and how long ago it changed. */
const MemoryRow = ({
  file,
  now,
  onOpen,
}: {
  file: MemoryFile;
  now: number;
  onOpen: () => void;
}) => (
  <li className="border-b border-border">
    <button
      type="button"
      data-testid="memory-file"
      data-name={file.name}
      onClick={onOpen}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 px-1 py-3 text-left transition-colors duration-[120ms] hover:bg-hover sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
    >
      <span
        data-testid="memory-file-name"
        className="col-start-1 row-start-1 truncate text-[13.5px] text-text underline decoration-border-bold underline-offset-4"
      >
        {file.name}
      </span>
      <span
        data-testid="memory-file-description"
        className="col-span-2 col-start-1 row-start-2 truncate text-[13px] text-text-muted sm:col-span-1 sm:col-start-2 sm:row-start-1"
      >
        {file.description || (isIndex(file) ? "The index every thread reads first" : "")}
      </span>
      <time
        data-testid="memory-file-updated"
        dateTime={file.updatedAt}
        title={formatUpdated(file.updatedAt)}
        className="col-start-2 row-start-1 shrink-0 text-right text-[12.5px] whitespace-nowrap text-text-subtle sm:col-start-3"
      >
        Updated {formatAgo(file.updatedAt, now)}
      </time>
    </button>
  </li>
);

const MemoryNone = ({ testId, children }: { testId: string; children: React.ReactNode }) => (
  <li
    data-testid={testId}
    className="border-b border-border px-1 py-3 text-[12.5px] text-text-subtle"
  >
    {children}
  </li>
);
