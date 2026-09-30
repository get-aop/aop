import { BugIcon, HammerIcon, SearchCodeIcon } from "lucide-react";

import { Chip } from "@/ui/chip";

const DRAFT_SUGGESTIONS: Array<{ label: string; Icon: typeof HammerIcon }> = [
  { label: "Implement a feature", Icon: HammerIcon },
  { label: "Review a pull request", Icon: SearchCodeIcon },
  { label: "Debug failing tests", Icon: BugIcon },
];

/** Draft hero (concept “New session” view): centered wordmark above the composer. */
export const DraftWordmark = () => (
  <div className="flex shrink-0 justify-center px-6 pb-5 text-[52px] font-light leading-none tracking-[-0.02em] text-text select-none">
    aop
  </div>
);

/** Suggestion chips below the composer: each one prefills the draft. */
export const DraftSuggestions = ({ onSuggestion }: { onSuggestion: (prompt: string) => void }) => (
  <div className="flex shrink-0 flex-wrap justify-center gap-2 px-6 pt-3">
    {DRAFT_SUGGESTIONS.map(({ label, Icon }) => (
      <Chip key={label} variant="ghost" onClick={() => onSuggestion(label)} className="h-8">
        <Icon className="size-3.5 text-text-subtle" strokeWidth={1.7} />
        {label}
      </Chip>
    ))}
  </div>
);
