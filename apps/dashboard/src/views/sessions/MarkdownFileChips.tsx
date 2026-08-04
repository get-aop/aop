import { PanelRightIcon } from "lucide-react";
import { resolveMarkdownFileRefs } from "./markdown-file-refs";

export const MarkdownFileChips = ({
  content,
  repoPath,
  artifacts = [],
  onOpenFile,
}: {
  content: string;
  repoPath: string | null;
  artifacts?: Array<{ path: string; mimeType: "text/markdown" }>;
  onOpenFile: (path: string) => void;
}) => {
  const refs = resolveMarkdownFileRefs(
    content,
    repoPath,
    artifacts.map((artifact) => artifact.path),
  );
  if (refs.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {refs.map((ref) => (
        <button
          key={ref.path}
          type="button"
          title="Open in side view"
          aria-label={`Open ${ref.fileName} in side view`}
          className="focus-ring"
          onClick={() => onOpenFile(ref.path)}
          style={{
            width: "fit-content",
            minWidth: 300,
            maxWidth: 440,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 9px",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "var(--color-raised)",
            color: "var(--color-text)",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <span
            data-testid="markdown-file-chip-tile"
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              background: "color-mix(in srgb,var(--color-running) 15%,transparent)",
              color: "var(--color-running)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            MD
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <strong
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 11,
              }}
            >
              {ref.fileName}
            </strong>
            {ref.dir === "." ? null : (
              <small className="block truncate text-[11.5px] text-text-muted" title={ref.dir}>
                {ref.dir}
              </small>
            )}
          </span>
          <PanelRightIcon className="size-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
        </button>
      ))}
    </div>
  );
};
