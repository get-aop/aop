import { cva, type VariantProps } from "class-variance-authority";
import { FileTextIcon, ImageIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";

export type AttachmentState = "idle" | "uploading" | "error" | "done";

const attachmentVariants = cva(
  "inline-flex max-w-full items-center gap-2 rounded-control border border-border bg-raised px-2.5 py-1.5 text-[12px] text-text",
  {
    variants: {
      state: {
        idle: "",
        uploading: "",
        error: "border-blocked/40",
        done: "",
      } satisfies Record<AttachmentState, string>,
    },
    defaultVariants: {
      state: "idle",
    },
  },
);

interface AttachmentProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof attachmentVariants> {
  name: string;
  kind?: "image" | "document";
  /** 0–100 while uploading. */
  progress?: number;
  onRemove?: () => void;
  onRetry?: () => void;
  /** Renders the chip as an anchor (message document links). */
  href?: string;
}

/** Composer + message file chips with upload states (idle/uploading/error/done). */
function Attachment({
  name,
  kind = "document",
  state = "idle",
  progress,
  onRemove,
  onRetry,
  className,
  ...props
}: AttachmentProps) {
  const Icon = kind === "image" ? ImageIcon : FileTextIcon;
  return (
    <div
      data-slot="attachment"
      data-state={state}
      className={cn(attachmentVariants({ state }), className)}
      {...props}
    >
      <Icon className="size-3.5 shrink-0 text-text-subtle" />
      <span className="min-w-0 truncate">{name}</span>
      {state === "uploading" ? (
        <Progress value={progress ?? 0} className="h-1 w-12" aria-label={`Uploading ${name}`} />
      ) : null}
      {state === "error" ? (
        <>
          <span className="shrink-0 text-blocked">Failed</span>
          {onRetry ? (
            <Button variant="ghost" size="xs" className="h-5 px-1.5" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="shrink-0 rounded-full p-0.5 text-text-subtle hover:bg-hover hover:text-text"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export { Attachment };
