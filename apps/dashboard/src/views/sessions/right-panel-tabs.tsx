/** Phase-4 port onto kit primitives; superseded by workspace/right-panel in Phase 5. */
import { FileDiffIcon, FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

export type AopRightPanelSurface = "diff" | "file";

interface RightPanelTabsProps {
  surface: AopRightPanelSurface;
  title: string;
  width: number;
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const SurfaceIcon = props.surface === "diff" ? FileDiffIcon : FileTextIcon;
  return (
    <aside
      className="relative flex h-full min-h-0 min-w-0 shrink-0 flex-col self-stretch border-l border-border bg-background"
      style={{ width: props.width }}
      data-testid="session-right-panel"
      data-preview-panel-mode="inline"
    >
      <div
        className="flex h-[var(--session-chat-topbar-height)] shrink-0 items-center gap-1 border-b border-border pl-2 pr-3"
        data-right-panel-tabbar
      >
        <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <div
            data-active-tab="true"
            className="group flex h-7 min-w-25 max-w-44 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2 text-sm text-foreground"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5">
                  <SurfaceIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{props.title}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{props.title}</TooltipContent>
            </Tooltip>
            <button
              type="button"
              className={cn(
                "relative flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted focus:opacity-100",
                props.pending ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              aria-label={`Close ${props.title}`}
              onClick={props.onClose}
            >
              {props.pending ? (
                <>
                  <span
                    className="size-2 rounded-full bg-current group-hover:hidden"
                    aria-hidden="true"
                  />
                  <XIcon className="hidden size-3 group-hover:block" />
                </>
              ) : (
                <XIcon className="size-3" />
              )}
            </button>
          </div>
          <button
            type="button"
            className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-45"
            aria-label="Add panel surface"
            aria-disabled="true"
            title="More panel surfaces require additional AOP backends"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{props.children}</div>
    </aside>
  );
}
