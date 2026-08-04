import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  FileTextIcon,
  Maximize2Icon,
  Minimize2Icon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { getMarkdownFile, saveMarkdownFile } from "../../api/client";
import { ChatMarkdown } from "./ChatMarkdown";
import { RightPanelTabs } from "./right-panel-tabs";

interface SessionMarkdownPanelProps {
  path: string;
  onClose: () => void;
  showToast: (message: string) => void;
  width?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export const SessionMarkdownPanel = ({
  path,
  onClose,
  showToast,
  width = 540,
  expanded = false,
  onToggleExpand,
}: SessionMarkdownPanelProps) => {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirmRevert, setConfirmRevert] = useState(false);

  useEffect(() => {
    void retry;
    setEditing(false);
    setLoading(true);
    setError(null);
    let cancelled = false;
    getMarkdownFile(path)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        setDraft(file.content);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        const message =
          loadError instanceof Error ? loadError.message : "Could not load Markdown file";
        setError(message);
        showToast(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, retry, showToast]);

  const copyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = path;
      textarea.setAttribute("aria-hidden", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast("Path copied");
  }, [path, showToast]);

  const save = async () => {
    try {
      const file = await saveMarkdownFile(path, draft);
      setContent(file.content ?? draft);
      setEditing(false);
      showToast(`Saved · ${fileName(path)}`);
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Save failed");
    }
  };

  const leaveEditMode = () => {
    setDraft(content);
    setEditing(false);
    setConfirmRevert(false);
  };

  return (
    <RightPanelTabs
      surface="file"
      title={fileName(path)}
      width={width}
      pending={editing}
      onClose={onClose}
    >
      <div
        data-testid="session-markdown-panel"
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
      >
        <PanelHeader
          path={path}
          editing={editing}
          expanded={expanded}
          onCopy={() => void copyPath()}
          onToggleExpand={onToggleExpand}
          onEditSave={editing ? () => void save() : () => setEditing(true)}
          onClose={onClose}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
          <PanelBody
            loading={loading}
            error={error}
            content={content}
            draft={draft}
            editing={editing}
            onDraftChange={setDraft}
            onRetry={() => setRetry((value) => value + 1)}
            onCopy={() => void copyPath()}
            onSave={() => void save()}
            onEscape={() => (draft === content ? leaveEditMode() : setConfirmRevert(true))}
          />
        </div>
        <AlertDialog open={confirmRevert} onOpenChange={(next) => !next && setConfirmRevert(false)}>
          <AlertDialogContent className="w-[512px]">
            <AlertDialogHeader>
              <AlertDialogTitle>Discard Markdown changes?</AlertDialogTitle>
              <AlertDialogDescription>Your unsaved edits will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={leaveEditMode}>Discard</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RightPanelTabs>
  );
};

const PanelHeader = (props: {
  path: string;
  editing: boolean;
  expanded: boolean;
  onCopy: () => void;
  onToggleExpand?: () => void;
  onEditSave: () => void;
  onClose: () => void;
}) => {
  const { path, editing, expanded, onCopy, onToggleExpand, onEditSave, onClose } = props;
  return (
    <header className="flex items-center gap-2 border-b border-border p-3">
      <FileTextIcon className="size-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-text">{fileName(path)}</span>
        <span className="block truncate text-[11.5px] text-text-subtle" title={path}>
          {middleTruncatePath(directoryName(path))}
        </span>
      </span>
      <span className="ml-auto" />
      <button
        type="button"
        aria-label="Copy path"
        title="Copy path"
        onClick={onCopy}
        className="grid size-7 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <CopyIcon className="size-3.5" strokeWidth={1.7} />
      </button>
      {onToggleExpand ? (
        <button
          type="button"
          aria-label={expanded ? "Restore" : "Expand"}
          title={expanded ? "Restore" : "Expand"}
          onClick={onToggleExpand}
          className="grid size-7 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          {expanded ? (
            <Minimize2Icon className="size-3.5" strokeWidth={1.7} />
          ) : (
            <Maximize2Icon className="size-3.5" strokeWidth={1.7} />
          )}
        </button>
      ) : null}
      <EditSaveButton editing={editing} onClick={onEditSave} />
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={onClose}
        className="grid size-7 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <XIcon className="size-3.5" strokeWidth={1.7} />
      </button>
    </header>
  );
};

export const middleTruncatePath = (path: string, visibleSegments = 3): string => {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= visibleSegments + 1) return path;
  const prefix = path.startsWith("/") ? "/" : "";
  return `${prefix}${segments[0]}/…/${segments.slice(-visibleSegments).join("/")}`;
};

const PanelBody = ({
  loading,
  error,
  content,
  draft,
  editing,
  onDraftChange,
  onRetry,
  onCopy,
  onSave,
  onEscape,
}: {
  loading: boolean;
  error: string | null;
  content: string;
  draft: string;
  editing: boolean;
  onDraftChange: (value: string) => void;
  onRetry: () => void;
  onCopy: () => void;
  onSave: () => void;
  onEscape: () => void;
}) => {
  if (loading)
    return (
      <div role="status" aria-label="Loading Markdown" className="space-y-3">
        {["w-3/4", "w-full", "w-2/3"].map((width) => (
          <span
            key={width}
            data-testid="markdown-loading-bar"
            className={`aop-pulse block h-3 rounded-pill bg-raised ${width}`}
          />
        ))}
      </div>
    );
  if (error) {
    return (
      <div className="m-auto flex max-w-xs flex-col items-center gap-3 text-center">
        <CircleAlertIcon className="size-6 text-blocked" strokeWidth={1.7} />
        <p role="alert" className="text-[13px] text-text-muted">
          {error}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={onCopy}>
            Copy path
          </Button>
        </div>
      </div>
    );
  }
  if (editing) {
    return (
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => handleEditorKeyDown(event, onSave, onEscape)}
        spellCheck={false}
        className="focus-ring min-h-0 flex-1 resize-none rounded-control bg-canvas p-3 font-mono text-[12px] text-text"
      />
    );
  }
  if (!content)
    return (
      <p className="m-auto text-[11.5px] text-text-subtle">Empty file — Edit to add content.</p>
    );
  return <ChatMarkdown content={content} />;
};

const handleEditorKeyDown = (
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  onSave: () => void,
  onEscape: () => void,
) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    onSave();
  } else if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
  }
};

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const directoryName = (path: string): string =>
  path.slice(0, Math.max(0, path.length - fileName(path).length - 1));

const EditSaveButton = ({ editing, onClick }: { editing: boolean; onClick: () => void }) => (
  <button
    type="button"
    aria-label={editing ? "Save" : "Edit"}
    title={editing ? "Save" : "Edit"}
    onClick={onClick}
    className="flex h-7 items-center gap-1 rounded-row px-2 text-[12px] font-medium text-running transition-colors duration-[120ms] hover:bg-hover"
  >
    {editing ? (
      <CheckIcon className="size-3.5" strokeWidth={1.7} />
    ) : (
      <PencilIcon className="size-3.5" strokeWidth={1.7} />
    )}
    {editing ? "Save" : "Edit"}
  </button>
);
