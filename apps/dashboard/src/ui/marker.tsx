import { cn } from "@/lib/cn";
import { Spinner } from "@/ui/spinner";

/** In-thread system lines, 12px subtle (work-log/step events, streaming status). */
function Marker({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="marker"
      className={cn("flex items-center gap-2 py-1 text-[12px] text-text-subtle", className)}
      {...props}
    />
  );
}

/** Streaming markers show the ring spinner as their icon. */
function MarkerIcon({
  streaming = false,
  className,
  ...props
}: React.ComponentProps<"span"> & { streaming?: boolean }) {
  if (streaming) {
    return <Spinner className={cn("size-3", className)} />;
  }
  return (
    <span
      data-slot="marker-icon"
      className={cn("inline-flex size-3 shrink-0 items-center justify-center", className)}
      {...props}
    />
  );
}

/** Day separators: a line with a centered caption. */
function MarkerSeparator({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="marker-separator"
      className={cn("flex items-center gap-3 py-2 text-[11px] text-text-subtle", className)}
      {...props}
    >
      <span className="h-px flex-1 bg-border" />
      {children ? <span className="shrink-0">{children}</span> : null}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export { Marker, MarkerIcon, MarkerSeparator };
