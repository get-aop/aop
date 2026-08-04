import { cn } from "@/lib/cn";

/**
 * THE spinner — a plain ring (1.5px border, top border colored, 1s rotate).
 * Plain ring only. Reduced-motion kills the rotation via the
 * .aop-spinner rule in index.css.
 */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn(
        "aop-spinner inline-block size-4 shrink-0 rounded-full border-[1.5px] border-border-bold border-t-text motion-safe:animate-[aop-spin_1s_linear_infinite]",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
