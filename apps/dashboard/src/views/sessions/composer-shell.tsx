import type { CONTROL_COMMANDS } from "@aop/common";
import { CircleAlertIcon, FolderIcon, GitBranchIcon, XIcon } from "lucide-react";
import type { ClipboardEvent, KeyboardEvent, MutableRefObject, ReactNode, RefObject } from "react";
import { ComposerHighlightLayer, type MentionToken } from "./composer-highlights";
import { TypeaheadPopover } from "./composer-typeahead";
import type { TypeaheadItem, TypeaheadMatch } from "./typeahead";

export const ComposerInputStack = ({
  input,
  highlightTokens,
  textareaRef,
  localInputEditRef,
  isComposingRef,
  onInput,
  setCaret,
  setTypeaheadIndex,
  setSlashIndex,
  onKeyDown,
  onPaste,
  locked = false,
}: {
  input: string;
  highlightTokens: MentionToken[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  localInputEditRef: MutableRefObject<boolean>;
  isComposingRef: MutableRefObject<boolean>;
  onInput: (value: string) => void;
  setCaret: (value: number) => void;
  setTypeaheadIndex: (value: number) => void;
  setSlashIndex: (value: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Workflow run in progress: the composer waits and accepts no input. */
  locked?: boolean;
}) => (
  <div className="composer-input-stack">
    <ComposerHighlightLayer input={input} tokens={highlightTokens} textareaRef={textareaRef} />
    <textarea
      ref={textareaRef}
      data-testid="chat-composer-input"
      className="composer-input composer-text-surface chat-text-surface"
      value={input}
      onChange={(event) => {
        const value = event.target.value;
        // Capture selection before the controlled-state update can rerender the textarea.
        const nextCaret = event.target.selectionStart;
        // Height/selection restores abort IME composition (accents, smart quotes on macOS).
        if (!isComposingRef.current) {
          resizeComposerInput(event.currentTarget);
        }
        localInputEditRef.current = true;
        onInput(value);
        setCaret(typeof nextCaret === "number" ? nextCaret : value.length);
        setTypeaheadIndex(-1);
        setSlashIndex(0);
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        isComposingRef.current = false;
        resizeComposerInput(event.currentTarget);
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
      }}
      onSelect={(event) =>
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
      }
      onKeyUp={(event) =>
        setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
      }
      onClick={(event) => {
        const nextCaret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
        setCaret(nextCaret);
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      readOnly={locked}
      rows={2}
      placeholder={
        locked
          ? "Workflow running — the chat resumes when it finishes"
          : "Ask anything, @tag files/folders, $use skills, or / for commands"
      }
    />
  </div>
);

export type SessionGitDiffstatView = {
  filesChanged: number;
  additions: number;
  deletions: number;
};

export const SessionLocationStrip = ({
  worktreePath,
  branch,
  gitDiffstat,
  onDiffstatClick,
  gitPrControls,
  workers,
  defaultWorkerId,
  defaultWorkflowId,
  onDefaultWorkerChange,
  onDefaultWorkflowChange,
  onToast,
}: {
  worktreePath: string | null;
  branch: string | null;
  gitDiffstat?: SessionGitDiffstatView | null;
  onDiffstatClick?: () => void;
  gitPrControls?: ReactNode;
  workers: Array<{ id: string; name: string }>;
  defaultWorkerId: string | null;
  defaultWorkflowId: string | null;
  onDefaultWorkerChange?: (workerId: string | null) => void;
  onDefaultWorkflowChange?: (workflowId: string | null) => void;
  onToast?: (message: string) => void;
}) => {
  if (!worktreePath) return null;
  const worker = workers.find((candidate) => candidate.id === defaultWorkerId);
  const copyPath = async () => {
    await navigator.clipboard.writeText(worktreePath);
    onToast?.("Path copied");
  };
  return (
    <div
      data-testid="composer-session-location"
      className="mb-2 flex h-6 min-w-0 items-center gap-2 overflow-hidden text-[11.5px] text-text-muted"
    >
      <FolderIcon className="size-3" strokeWidth={1.7} />
      <button
        type="button"
        title={worktreePath}
        onClick={() => void copyPath()}
        className="focus-ring min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
      >
        {abbreviatePath(worktreePath)}
      </button>
      <span aria-hidden="true">·</span>
      <GitBranchIcon className="size-3" strokeWidth={1.7} />
      <BranchChip branch={branch} />
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <GitDiffstatChip diffstat={gitDiffstat} onClick={onDiffstatClick} />
        {gitPrControls}
        {worker ? (
          <DefaultContextPill
            label={`@${worker.name}`}
            onClear={() => onDefaultWorkerChange?.(null)}
          />
        ) : null}
        {defaultWorkflowId ? (
          <DefaultContextPill
            label={`#${defaultWorkflowId}`}
            onClear={() => onDefaultWorkflowChange?.(null)}
          />
        ) : null}
      </span>
    </div>
  );
};

const BranchChip = ({ branch }: { branch: string | null }) => (
  <span
    title={branch ?? undefined}
    className={`min-w-0 max-w-[280px] shrink overflow-hidden text-ellipsis whitespace-nowrap rounded-pill border px-2 py-0.5 font-mono text-[12px] ${
      branch
        ? "border-[color-mix(in_srgb,var(--color-running)_30%,transparent)] bg-[var(--mention-control-bg)] text-running"
        : "border-border text-text-subtle"
    }`}
  >
    {branch ?? "no branch"}
  </span>
);

export const GitDiffstatChip = ({
  diffstat,
  onClick,
}: {
  diffstat?: SessionGitDiffstatView | null;
  onClick?: () => void;
}) => {
  if (!diffstat || diffstat.filesChanged <= 0) return null;
  const fileLabel = diffstat.filesChanged === 1 ? "file" : "files";
  const className =
    "inline-flex h-5 shrink-0 items-center rounded-pill border border-border bg-surface px-2 font-mono text-[12px] focus-ring";
  const title = `${diffstat.filesChanged} ${fileLabel} changed`;
  const content = (
    <>
      <span className="text-ok">+{diffstat.additions}</span>
      <span className="text-text-subtle">{"\u00a0"}</span>
      <span className="text-blocked">−{diffstat.deletions}</span>
    </>
  );
  if (!onClick) {
    return (
      <span data-testid="session-git-diffstat" className={className} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="session-git-diffstat"
      className={className}
      title={title}
      aria-label="Toggle session diff panel"
      onClick={onClick}
    >
      {content}
    </button>
  );
};

const DefaultContextPill = ({ label, onClear }: { label: string; onClear: () => void }) => (
  <span className="inline-flex items-center gap-1 rounded-pill bg-[var(--mention-bg)] px-2 py-0.5 text-[11.5px] text-favorite">
    {label}
    <button type="button" aria-label={`Clear ${label}`} title={`Clear ${label}`} onClick={onClear}>
      <XIcon className="size-3" strokeWidth={1.7} />
    </button>
  </span>
);

export const ControlWarningLine = ({
  command,
}: {
  command: (typeof CONTROL_COMMANDS)[number] | undefined;
}) => {
  if (!command) return null;
  return (
    <div
      data-testid="composer-control-warning"
      className="mt-1 flex items-center gap-1 text-[11.5px] text-favorite"
    >
      <CircleAlertIcon className="size-3.5 shrink-0" strokeWidth={1.7} /> {controlWarning(command)}
    </div>
  );
};

export const TypeaheadSlot = ({
  match,
  activeIndex,
  onActiveIndexChange,
  onPick,
}: {
  match: TypeaheadMatch | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (item: TypeaheadItem) => void;
}) => {
  if (!match || match.items.length === 0) return null;
  return (
    <TypeaheadPopover
      items={match.items}
      activeIndex={activeIndex}
      onActiveIndexChange={onActiveIndexChange}
      onPick={onPick}
    />
  );
};

export const resizeComposerInput = (textarea: HTMLTextAreaElement | null): void => {
  if (!textarea) return;
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  textarea.style.height = "auto";
  const contentHeight = Math.max(70, textarea.scrollHeight);
  textarea.style.height = `${contentHeight}px`;
  textarea.style.overflowX = "hidden";
  textarea.style.overflowY = "hidden";
  // Some engines move the caret while the height is collapsed to "auto".
  if (
    typeof selectionStart === "number" &&
    typeof selectionEnd === "number" &&
    (textarea.selectionStart !== selectionStart || textarea.selectionEnd !== selectionEnd)
  ) {
    textarea.setSelectionRange(selectionStart, selectionEnd);
  }
};

const abbreviatePath = (path: string): string => {
  const home = path.replace(/^\/Users\/[^/]+/, "~");
  const segments = home.split("/");
  if (segments.length <= 4) return home;
  return `${segments[0]}/…/${segments.slice(-2).join("/")}`;
};

const controlWarning = (command: (typeof CONTROL_COMMANDS)[number]): string => {
  if (command.id === "CC_BROWSER_USE") return "Uses your signed-in Chrome profile";
  if (command.id === "CC_COMPUTER_USE") return "Unavailable in detached Claude sessions";
  if (command.capability === "browser") return "Runs autonomous isolated browser control";
  return "Can control your computer";
};
