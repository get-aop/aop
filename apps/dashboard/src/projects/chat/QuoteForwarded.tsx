import { ChevronDownIcon, CornerUpRightIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";

/** The person's own words, as the coordinator relayed them to a thread; it opens folded away from the brief below it. */
export const QuoteForwarded = ({ text }: { text: string }) => (
  <Collapsible
    defaultOpen
    data-testid="quote-forwarded"
    className="group/quote my-1.5 max-w-xl rounded-card border border-border bg-raised/60"
  >
    <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text-subtle outline-none hover:text-text-muted">
      <CornerUpRightIcon aria-hidden="true" className="size-3.5" />
      <span className="flex-1">Message forwarded from project chat</span>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3.5 transition-transform group-data-[state=closed]/quote:-rotate-90"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <blockquote
        data-testid="quote-forwarded-text"
        className="whitespace-pre-wrap border-t border-border px-3 py-2 text-[13px] leading-relaxed text-text-muted"
      >
        {text}
      </blockquote>
    </CollapsibleContent>
  </Collapsible>
);
