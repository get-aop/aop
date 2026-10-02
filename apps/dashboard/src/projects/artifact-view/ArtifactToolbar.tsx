import {
  BookmarkPlusIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LibraryBigIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { saveWorkspaceFile } from "../../api/artifacts";
import { IconButton } from "../../components/IconButton";
import { copyContent, downloadBlob, downloadName, formatBytes } from "./file-actions";
import { KIND_META } from "./kind-meta";
import { canOpenInLibrary, openInLibrary } from "./library-link";
import { openArtifactView } from "./open-artifact-view";
import type { ShownArtifact } from "./use-artifact";
import { VersionMenu } from "./VersionMenu";

/**
 * What the version shown is (its kind, size and version), and what can be done with it: switch
 * or compare versions, see the source, copy, download, find it in the Library (or keep a linked
 * file there), and fill the window. It wraps onto a second line when the column is narrow.
 */
export const ArtifactToolbar = ({
  projectId,
  shown,
  file,
  raw,
  onRaw,
  onSelectVersion,
  onCompare,
  fullscreen,
  onToggleFullscreen,
}: {
  projectId: string;
  shown: ShownArtifact;
  /** A file a reply linked, not (yet) in the Library. */
  file: { threadId: string | null; path: string } | null;
  raw: boolean;
  /** Null when the kind has no source view to switch to. */
  onRaw: ((raw: boolean) => void) | null;
  onSelectVersion: (version: number) => void;
  onCompare: (base: number) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) => {
  const { detail, version, content } = shown;
  const meta = KIND_META[content.kind];
  const size =
    detail.versions.find((entry) => entry.version === version)?.size ?? content.blob.size;
  return (
    <div
      data-testid="artifact-toolbar"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-2"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-meta text-text-subtle">
        <meta.icon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        <span data-testid="artifact-kind" className="text-text-muted">
          {meta.label}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatBytes(size)}</span>
        {file ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={file.path}>
              {file.path}
            </span>
          </>
        ) : null}
      </p>
      <div className="ml-auto flex items-center gap-1">
        {detail.versioned && detail.versions.length > 1 ? (
          <VersionMenu
            detail={detail}
            version={version}
            canCompare={content.text !== null}
            onSelect={onSelectVersion}
            onCompare={onCompare}
          />
        ) : null}
        {onRaw ? <SourceToggle raw={raw} onRaw={onRaw} /> : null}
        <CopyButton shown={shown} />
        <IconButton
          testId="artifact-download"
          label="Download"
          onClick={() => downloadBlob(content.blob, downloadName(detail, version))}
        >
          <DownloadIcon />
        </IconButton>
        {file ? (
          <KeepButton projectId={projectId} file={file} />
        ) : canOpenInLibrary() ? (
          <IconButton
            testId="artifact-open-library"
            label="Open in Library"
            onClick={() => openInLibrary(projectId, detail.id)}
          >
            <LibraryBigIcon />
          </IconButton>
        ) : null}
        <IconButton
          testId="artifact-fullscreen"
          label={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          pressed={fullscreen}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
        </IconButton>
      </div>
    </div>
  );
};

const SourceToggle = ({ raw, onRaw }: { raw: boolean; onRaw: (raw: boolean) => void }) => (
  <div
    data-testid="artifact-source-toggle"
    className="flex h-8 items-center rounded-row border border-border p-0.5 text-meta"
  >
    {(["Preview", "Source"] as const).map((label) => {
      const selected = (label === "Source") === raw;
      return (
        <button
          key={label}
          type="button"
          aria-pressed={selected}
          data-testid={`artifact-${label.toLowerCase()}`}
          onClick={() => onRaw(label === "Source")}
          className={cn(
            "h-full rounded-[6px] px-2 text-text-subtle hover:text-text",
            selected && "bg-active text-text",
          )}
        >
          {label}
        </button>
      );
    })}
  </div>
);

const CopyButton = ({ shown }: { shown: ShownArtifact }) => {
  const [copied, setCopied] = useState(false);
  const { content } = shown;
  // The clipboard takes text, and PNG images; other images are downloaded instead.
  if (content.text === null && content.blob.type !== "image/png") return null;
  return (
    <IconButton
      testId="artifact-copy"
      label={copied ? "Copied" : "Copy"}
      onClick={() =>
        void copyContent(content.blob, content.text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          })
          .catch(() => toast.error("Could not copy it"))
      }
    >
      {copied ? <CheckIcon className="text-ok" /> : <CopyIcon />}
    </IconButton>
  );
};

/** A linked workspace file, kept in the Library as an artifact, which the view then shows. */
const KeepButton = ({
  projectId,
  file,
}: {
  projectId: string;
  file: { threadId: string | null; path: string };
}) => {
  const [saving, setSaving] = useState(false);
  return (
    <IconButton
      testId="artifact-save-library"
      label="Save to Library"
      disabled={saving}
      onClick={() => {
        setSaving(true);
        void saveWorkspaceFile(projectId, file.threadId, file.path)
          .then((artifact) => {
            toast.success("Saved to the Library");
            openArtifactView(projectId, { kind: "artifact", id: artifact.id });
          })
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : String(error)),
          )
          .finally(() => setSaving(false));
      }}
    >
      <BookmarkPlusIcon />
    </IconButton>
  );
};
