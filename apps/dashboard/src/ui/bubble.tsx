import { cn } from "@/lib/cn";

/** User turns: raised fill, 16px radius with a 6px tail corner, max-width 76%, right-aligned. */
function Bubble({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble"
      className={cn(
        "ml-auto w-fit max-w-[76%] rounded-2xl rounded-br-md bg-raised px-3.5 py-2.5 text-[14px] leading-relaxed text-text",
        className,
      )}
      {...props}
    />
  );
}

export { Bubble };
