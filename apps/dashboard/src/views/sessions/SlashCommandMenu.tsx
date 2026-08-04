import { BotIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { ComposerSuggestionMenu } from "./ComposerSuggestionMenu";
import {
  applySlashCommandInsert,
  filterSlashCommands,
  isExactLeadingSlashCommand,
  matchSlashToken,
  type SlashTokenMatch,
} from "./sessions-runtime";

interface SlashCommandMenuProps {
  input: string;
  caret: number;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (cmd: string) => void;
  dismissed?: boolean;
}

export const SlashCommandMenu = ({
  input,
  caret,
  activeIndex,
  onActiveIndexChange,
  onPick,
  dismissed = false,
}: SlashCommandMenuProps) => {
  const slashItems = filterSlashCommands(input, caret);
  if (dismissed || slashItems.length === 0) return null;

  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-[var(--z-menu)]">
      <ComposerSuggestionMenu
        testId="slash-command-menu"
        ariaLabel="AOP commands"
        heading="AOP commands"
        items={slashItems.map((item) => ({
          id: item.cmd,
          label: item.cmd,
          description: `${item.args} · ${item.desc}`,
          icon: <BotIcon className="size-4" />,
        }))}
        activeIndex={activeIndex}
        onActiveIndexChange={onActiveIndexChange}
        onPick={(index) => {
          const item = slashItems[index];
          if (item) onPick(`${item.cmd} `);
        }}
      />
    </div>
  );
};

export const handleSlashCommandKeys = ({
  event,
  input,
  caret,
  activeIndex,
  setActiveIndex,
  onPick,
  onDismiss,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  input: string;
  caret: number;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onPick: (command: string) => void;
  onDismiss: () => void;
}): boolean => {
  const items = filterSlashCommands(input, caret);
  if (items.length === 0) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    onDismiss();
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    setActiveIndex((activeIndex + delta + items.length) % items.length);
    return true;
  }
  return handleSlashCommandPickKey({ event, input, caret, items, activeIndex, onPick });
};

/** Enter/Tab selection; bypass Enter when the leading command should execute immediately. */
const handleSlashCommandPickKey = ({
  event,
  input,
  caret,
  items,
  activeIndex,
  onPick,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  input: string;
  caret: number;
  items: ReturnType<typeof filterSlashCommands>;
  activeIndex: number;
  onPick: (command: string) => void;
}): boolean => {
  if (event.key !== "Enter" && event.key !== "Tab") return false;
  // Exact leading commands (e.g. `/status`) execute via onSend; do not complete them.
  if (event.key === "Enter" && isExactLeadingSlashCommand(input, caret)) return false;
  const item = items[activeIndex];
  if (!item) return false;
  event.preventDefault();
  onPick(`${item.cmd} `);
  return true;
};

export const applySlashPickToDraft = (
  draft: string,
  caret: number,
  command: string,
): { draft: string; caret: number; token: SlashTokenMatch | null } => {
  const token = matchSlashToken(draft, caret);
  if (!token) {
    return { draft: command, caret: command.length, token: null };
  }
  if (!command) {
    const next = `${draft.slice(0, token.start)}${draft.slice(token.end)}`;
    return { draft: next, caret: token.start, token };
  }
  const next = applySlashCommandInsert(draft, token, command);
  return { ...next, token };
};
