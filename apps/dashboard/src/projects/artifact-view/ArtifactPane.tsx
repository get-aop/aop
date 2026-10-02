import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { ArtifactViewRef } from "../../shell/router";
import { ArtifactViewer } from "./ArtifactViewer";
import { closeArtifactView } from "./open-artifact-view";
import { useEscape, useTakeFocusFromHiddenChat } from "./pane-focus";
import { refKey } from "./use-artifact";
import { VisualizeView } from "./visualize/VisualizeView";

/**
 * The artifact view in the coordinator chat's place, under a breadcrumb back to the chat. The
 * chat is hidden underneath, never unmounted, so "Coordinator", × and Escape bring it back as it
 * was. Fullscreen lifts the view over the whole window; Escape leaves it first.
 */
export const ArtifactPane = ({
  projectId,
  artifact,
}: {
  projectId: string;
  artifact: ArtifactViewRef;
}) => {
  const paneRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEscape(() => (fullscreen ? setFullscreen(false) : closeArtifactView()));
  useTakeFocusFromHiddenChat(paneRef, refKey(artifact));
  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      data-testid="artifact-pane"
      data-fullscreen={fullscreen ? "true" : undefined}
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-canvas outline-none",
        fullscreen && "fixed inset-0 z-[var(--z-modal)]",
      )}
    >
      {artifact.kind === "visualize" ? (
        <VisualizeView projectId={projectId} messageId={artifact.messageId} />
      ) : (
        <ArtifactViewer
          key={artifact.kind === "artifact" ? artifact.id : refKey(artifact)}
          projectId={projectId}
          artifact={artifact}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
        />
      )}
    </div>
  );
};
