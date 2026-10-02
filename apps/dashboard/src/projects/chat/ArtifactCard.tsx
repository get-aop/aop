import type { ArtifactKind } from "@aop/common";
import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "@/lib/cn";
import { KIND_META } from "../artifact-view/kind-meta";
import { openArtifactView } from "../artifact-view/open-artifact-view";
import { useChatContext } from "./chat-context";

/**
 * An artifact the turn made, where it made it: its kind's icon, its title, what it is and which
 * version. A click opens it in the artifact view, in the coordinator chat's place, from a
 * thread's chat as well (that thread stays open beside it).
 */
export const ArtifactCard = memo(function ArtifactCard({
  artifactId,
  title,
  kind,
  version,
  action,
  inline = false,
}: {
  artifactId: string;
  title: string;
  kind: ArtifactKind;
  version?: number;
  action?: "created" | "updated";
  /** Inside a sentence (an `artifact:` link): a compact pill. */
  inline?: boolean;
}) {
  const { projectId } = useChatContext();
  const meta = KIND_META[kind];
  const open = () => openArtifactView(projectId, { kind: "artifact", id: artifactId, version });
  if (inline) {
    return (
      <button
        type="button"
        data-testid="artifact-chip"
        data-artifact-id={artifactId}
        onClick={open}
        className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-row border border-border bg-raised px-1.5 align-baseline text-meta text-text hover:border-border-strong hover:bg-hover"
      >
        <meta.icon aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
        <span className="truncate">{title}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="artifact-card"
      data-artifact-id={artifactId}
      data-version={version}
      onClick={open}
      className={cn(
        "group/card my-2 flex w-full max-w-md items-center gap-3 rounded-card border border-border bg-surface px-3 py-2.5 text-left",
        "transition-colors duration-[120ms] hover:border-border-strong hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-row border border-border bg-raised text-text-muted">
        <meta.icon aria-hidden="true" className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          data-testid="artifact-card-title"
          className="block truncate text-body font-medium text-text"
        >
          {title}
        </span>
        <span
          data-testid="artifact-card-meta"
          className="block truncate text-meta text-text-subtle"
        >
          {meta.label}
          {version ? ` · v${version}` : ""}
          {action === "updated" ? " · updated" : ""}
        </span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-text-subtle transition-transform group-hover/card:translate-x-0.5 group-hover/card:text-text"
      />
    </button>
  );
});
