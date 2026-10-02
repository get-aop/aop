import { TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/ui/skeleton";
import type { ArtifactViewRef } from "../../shell/router";
import { ArtifactBreadcrumb } from "./ArtifactBreadcrumb";
import { ArtifactToolbar } from "./ArtifactToolbar";
import { replaceArtifactView } from "./open-artifact-view";
import { ArtifactBody, hasRawView } from "./renderers/ArtifactBody";
import { DiffView } from "./renderers/DiffView";
import { type ShownArtifact, useArtifact, useVersionText } from "./use-artifact";
import { VisualizeBar } from "./visualize/VisualizeBar";

type FileRef = Exclude<ArtifactViewRef, { kind: "visualize" }>;

/** An artifact or a file: its toolbar over the version shown, drawn, as source, or compared. */
export const ArtifactViewer = ({
  projectId,
  artifact,
  fullscreen,
  onToggleFullscreen,
}: {
  projectId: string;
  artifact: FileRef;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) => {
  const state = useArtifact(projectId, artifact);
  const [raw, setRaw] = useState(false);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  if (state.state === "loading") return <Loading />;
  if (state.state === "failed") return <Failed error={state.error} />;
  const selectVersion = (version: number) => {
    setCompareWith(null);
    replaceArtifactView(projectId, { kind: "artifact", id: state.detail.id, version });
  };
  return (
    <>
      <ArtifactBreadcrumb current={state.detail.title} />
      <ArtifactToolbar
        projectId={projectId}
        shown={state}
        file={artifact.kind === "file" ? artifact : null}
        raw={raw}
        onRaw={hasRawView(state.content.kind) ? setRaw : null}
        onSelectVersion={selectVersion}
        onCompare={setCompareWith}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
      {state.detail.originMessageId ? (
        <VisualizeBar
          projectId={projectId}
          messageId={state.detail.originMessageId}
          shown={state}
        />
      ) : null}
      <div data-testid="artifact-body" className="flex min-h-0 flex-1 flex-col overflow-auto">
        {compareWith !== null && state.content.text !== null ? (
          <Compare
            projectId={projectId}
            shown={state}
            base={compareWith}
            onClose={() => setCompareWith(null)}
          />
        ) : (
          // Streamdown keeps a rendered cell where one was before, whatever it now says: each
          // version gets a renderer of its own.
          <ArtifactBody key={state.version} content={state.content} raw={raw} />
        )}
      </div>
    </>
  );
};

const Compare = ({
  projectId,
  shown,
  base,
  onClose,
}: {
  projectId: string;
  shown: ShownArtifact;
  base: number;
  onClose: () => void;
}) => {
  const before = useVersionText(projectId, shown.detail.id, base);
  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-3">
        <h3 className="text-meta font-medium text-text">
          Changes from v{base} to v{shown.version}
        </h3>
        <button
          type="button"
          data-testid="artifact-compare-close"
          onClick={onClose}
          className="flex items-center gap-1 rounded-row px-2 py-1 text-meta text-text-subtle hover:bg-hover hover:text-text"
        >
          <XIcon className="size-3.5" /> Close comparison
        </button>
      </div>
      {before === null ? (
        <Skeleton className="m-4 h-40" />
      ) : (
        <DiffView
          before={before}
          after={shown.content.text ?? ""}
          beforeLabel={`v${base}`}
          afterLabel={`v${shown.version}`}
        />
      )}
    </div>
  );
};

const Loading = () => (
  <>
    <ArtifactBreadcrumb current="Loading…" />
    <div data-testid="artifact-loading" className="flex flex-col gap-3 p-6">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-40 w-full" />
    </div>
  </>
);

const Failed = ({ error }: { error: string }) => (
  <>
    <ArtifactBreadcrumb current="Not found" />
    <div
      data-testid="artifact-failed"
      className="flex flex-col items-center gap-2 px-6 py-16 text-center"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-5 text-waiting" />
      <p className="text-body text-text">This can't be shown.</p>
      <p className="max-w-md text-meta text-text-subtle">{error}</p>
    </div>
  </>
);
