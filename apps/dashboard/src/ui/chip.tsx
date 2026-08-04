import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/cn";

/**
 * THE chip — every pill in the app renders through these variants.
 * No other chip markup may exist (PLAN §5.1).
 *
 * filter: sidebar repo-scope chips (border; .on = white-9% fill)
 * ghost:  composer footer chips (transparent; .on = white-9% fill)
 * git:    composer git-row chips (11.5px, mono)
 * step:   workflow rail chips (raised bg + border; done/active/legacy states)
 * mini:   preview glyphs in pickers/lists
 */
const chipVariants = cva(
  "inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-[120ms] outline-none focus-visible:outline-2 focus-visible:outline-running focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        filter:
          "h-7 border border-border bg-transparent px-3 text-[12.5px] text-text-muted hover:bg-hover hover:text-text data-[on]:border-transparent data-[on]:bg-active data-[on]:text-text",
        ghost:
          "h-7 bg-transparent px-2.5 text-[12.5px] text-text-muted hover:bg-hover hover:text-text data-[on]:bg-active data-[on]:text-text",
        git: "h-6 gap-1 border border-border bg-raised px-2 font-mono text-[11.5px] text-text-muted hover:bg-hover hover:text-text",
        step: "h-7 border border-border bg-raised px-2.5 text-[12px] text-text data-[state=done]:text-text-subtle data-[state=active]:border-border-bold data-[state=legacy]:text-text-muted",
        mini: "h-5 gap-1 bg-raised px-1.5 text-[11px] text-text-muted",
      },
    },
    defaultVariants: {
      variant: "filter",
    },
  },
);

export interface ChipProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof chipVariants> {
  asChild?: boolean;
  /** Arms the chip (filter/ghost "on" state). */
  on?: boolean;
}

function Chip({ className, variant, on, asChild = false, ...props }: ChipProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="chip"
      data-variant={variant}
      data-on={on ? "" : undefined}
      className={cn(chipVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Chip, chipVariants };
