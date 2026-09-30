import { cn } from "@/lib/cn";

/** The look of a square icon button, for anything that has to be a link instead. */
export const iconButtonClass = (active = false, className?: string): string =>
  cn(
    "relative grid size-8 shrink-0 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4",
    active && "bg-active text-text",
    className,
  );

/**
 * A square icon button for the top bar and the panel's header, with a dot that asks for a look.
 * Any other button prop passes through, so a menu trigger (`asChild`) can hand it its own.
 */
export const IconButton = ({
  testId,
  label,
  active = false,
  dot = false,
  dotTestId,
  pressed,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "aria-label" | "aria-pressed" | "title"> & {
  testId: string;
  label: string;
  /** Drawn as the current choice (the panel toggle while the panel is open). */
  active?: boolean;
  dot?: boolean;
  dotTestId?: string;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    className={iconButtonClass(active, className)}
    {...props}
  >
    {children}
    {dot ? (
      <span
        data-testid={dotTestId}
        aria-hidden="true"
        className="absolute top-1 right-1 size-1.5 rounded-full bg-running"
      />
    ) : null}
  </button>
);
