import type { LibraryFileKind, LibraryItem } from "@aop/common";
import { DownloadIcon, FileWarningIcon, PinIcon, PinOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import { downloadLibraryItem, fetchLibraryContent } from "../../api/library";
import { ChatMarkdown } from "../chat/ChatMarkdown";
import { FileKindIcon } from "./file-icon";
import { ItemFacts } from "./ItemFacts";
import { kindOf } from "./library-view";

/** Text past this is cut from a preview; the download has all of it. */
export const PREVIEW_TEXT_MAX = 512 * 1024;

/**
 * An item opened in a dialog: its facts (folder, size, where it came from, when retention takes
 * it) over a preview of its content. Images, PDFs, markdown, code and plain text show as
 * themselves; anything else offers its download.
 */
export const LibraryPreview = ({
  projectId,
  item,
  threadTitle,
  onClose,
  onTogglePin,
  onShowSource,
}: {
  projectId: string;
  item: LibraryItem | null;
  threadTitle?: string;
  onClose: () => void;
  onTogglePin: (item: LibraryItem) => void;
  onShowSource: (item: LibraryItem) => void;
}) => (
  <Dialog open={item !== null} onOpenChange={(open) => (open ? null : onClose())}>
    {item ? (
      <DialogContent
        data-testid="library-preview"
        data-kind={kindOf(item)}
        className="flex max-h-[90vh] w-[min(960px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4 pr-12">
          <FileKindIcon kind={kindOf(item)} className="mt-0.5 size-5" />
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
            <DialogTitle className="truncate text-[15px] font-semibold" title={item.name}>
              {item.name}
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <ItemFacts
                  item={item}
                  threadTitle={threadTitle}
                  onShowSource={() => onShowSource(item)}
                />
              </div>
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              data-testid="library-preview-pin"
              aria-pressed={item.pinned}
              onClick={() => onTogglePin(item)}
            >
              {item.pinned ? <PinOffIcon /> : <PinIcon />}
              {item.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="library-preview-download"
              onClick={() => void downloadLibraryItem(projectId, item)}
            >
              <DownloadIcon />
              Download
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-canvas">
          <PreviewBody projectId={projectId} item={item} kind={kindOf(item)} />
        </div>
      </DialogContent>
    ) : null}
  </Dialog>
);

type Loaded =
  | { phase: "loading" }
  | { phase: "failed"; message: string }
  | { phase: "url"; url: string }
  | { phase: "text"; text: string; truncated: boolean };

const PreviewBody = ({
  projectId,
  item,
  kind,
}: {
  projectId: string;
  item: LibraryItem;
  kind: LibraryFileKind;
}) => {
  const loaded = useContent(projectId, item, kind);
  if (kind === "other") return <NoPreview item={item} projectId={projectId} />;
  if (loaded.phase === "loading") {
    return (
      <div data-testid="library-preview-loading" className="grid h-64 place-items-center">
        <Spinner />
      </div>
    );
  }
  if (loaded.phase === "failed") {
    return (
      <div
        data-testid="library-preview-error"
        className="flex h-64 flex-col items-center justify-center gap-2 text-meta text-text-muted"
      >
        <FileWarningIcon aria-hidden="true" className="size-6 text-blocked" />
        {loaded.message}
      </div>
    );
  }
  if (loaded.phase === "url") {
    return kind === "image" ? (
      <div className="grid min-h-64 place-items-center p-4">
        <img
          data-testid="library-preview-image"
          src={loaded.url}
          alt={item.name}
          className="max-h-[72vh] max-w-full rounded-md object-contain"
        />
      </div>
    ) : (
      <iframe
        data-testid="library-preview-pdf"
        title={item.name}
        src={loaded.url}
        className="h-[72vh] w-full border-0 bg-white"
      />
    );
  }
  return <TextPreview kind={kind} item={item} text={loaded.text} truncated={loaded.truncated} />;
};

const TextPreview = ({
  kind,
  item,
  text,
  truncated,
}: {
  kind: LibraryFileKind;
  item: LibraryItem;
  text: string;
  truncated: boolean;
}) => (
  <div className="flex flex-col gap-3 px-6 py-5">
    {kind === "markdown" ? (
      <div data-testid="library-preview-markdown">
        <ChatMarkdown content={text} />
      </div>
    ) : kind === "code" ? (
      <div data-testid="library-preview-code">
        <ChatMarkdown content={fenced(text, languageOf(item.name))} />
      </div>
    ) : (
      <pre
        data-testid="library-preview-text"
        className="font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-text"
      >
        {text}
      </pre>
    )}
    {truncated ? (
      <p data-testid="library-preview-truncated" className="text-meta text-text-subtle">
        The preview shows the first {PREVIEW_TEXT_MAX / 1024} KB. Download the file for all of it.
      </p>
    ) : null}
  </div>
);

const NoPreview = ({ item, projectId }: { item: LibraryItem; projectId: string }) => (
  <div
    data-testid="library-preview-none"
    className="flex h-64 flex-col items-center justify-center gap-3 text-meta text-text-muted"
  >
    <FileKindIcon kind="other" className="size-8" />
    No preview for this kind of file.
    <Button variant="secondary" size="sm" onClick={() => void downloadLibraryItem(projectId, item)}>
      <DownloadIcon />
      Download {item.name}
    </Button>
  </div>
);

const useContent = (projectId: string, item: LibraryItem, kind: LibraryFileKind): Loaded => {
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  useEffect(() => {
    if (kind === "other") return;
    let current = true;
    let url: string | null = null;
    setLoaded({ phase: "loading" });
    fetchLibraryContent(projectId, item.id)
      .then((blob) => readContent(blob, kind))
      .then(
        (next) => {
          if (next.phase === "url") url = next.url;
          if (current) setLoaded(next);
          else if (url) URL.revokeObjectURL(url);
        },
        () => current && setLoaded({ phase: "failed", message: "This file could not be loaded." }),
      );
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [projectId, item.id, kind]);
  return loaded;
};

// Images and PDFs show from a blob URL; the PDF viewer goes by the blob's type, so it is set.
const readContent = async (blob: Blob, kind: LibraryFileKind): Promise<Loaded> => {
  if (kind === "image" || kind === "pdf") {
    const typed = kind === "pdf" ? blob.slice(0, blob.size, "application/pdf") : blob;
    return { phase: "url", url: URL.createObjectURL(typed) };
  }
  const text = await blob.slice(0, PREVIEW_TEXT_MAX).text();
  return { phase: "text", text, truncated: blob.size > PREVIEW_TEXT_MAX };
};

/** A code block whose fence is longer than any run of backticks in the code, so none closes it. */
export const fenced = (code: string, language: string): string => {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
};

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  mmd: "mermaid",
  kt: "kotlin",
  cs: "csharp",
  cc: "cpp",
  hpp: "cpp",
  h: "c",
};

const languageOf = (name: string): string => {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? extension;
};
