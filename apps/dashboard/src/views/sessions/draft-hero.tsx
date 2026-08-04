import { BugIcon, HammerIcon, RocketIcon, SearchCodeIcon } from "lucide-react";

import { Chip } from "@/ui/chip";

export type DraftSuggestionId = "feature" | "review" | "debug" | "ship-it";

const DRAFT_SUGGESTIONS: Array<{
  id: DraftSuggestionId;
  label: string;
  Icon: typeof HammerIcon;
}> = [
  { id: "feature", label: "Implement a feature", Icon: HammerIcon },
  { id: "review", label: "Review a pull request", Icon: SearchCodeIcon },
  { id: "debug", label: "Debug failing tests", Icon: BugIcon },
  { id: "ship-it", label: "Run “Ship it”", Icon: RocketIcon },
];

/** Draft hero (concept “New session” view): centered wordmark above the composer. */
export const DraftWordmark = () => (
  <div className="flex shrink-0 justify-center px-6 pb-5 text-[52px] font-light leading-none tracking-[-0.02em] text-text select-none">
    aop
  </div>
);

/** Suggestion chips below the composer: the first three prefill, “Ship it” also arms the workflow. */
export const DraftSuggestions = ({
  onSuggestion,
}: {
  onSuggestion: (id: DraftSuggestionId) => void;
}) => (
  <div className="flex shrink-0 flex-wrap justify-center gap-2 px-6 pt-3">
    {DRAFT_SUGGESTIONS.map(({ id, label, Icon }) => (
      <Chip key={id} variant="ghost" onClick={() => onSuggestion(id)} className="h-8">
        <Icon className="size-3.5 text-text-subtle" strokeWidth={1.7} />
        {label}
      </Chip>
    ))}
  </div>
);
