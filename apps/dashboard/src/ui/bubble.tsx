import { cn } from "@/lib/cn";

/** User turns: raised fill, 16px radius with a 6px tail corner, max-width 76%, right-aligned. */
function Bubble({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble"
      className={cn(
        "ml-auto w-fit max-w-[76%] rounded-2xl rounded-br-md bg-raised px-4 py-3 text-body text-text",
        className,
      )}
      {...props}
    />
  );
}

export { Bubble };
