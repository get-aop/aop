import { FolderGit2Icon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { ComposerSuggestionMenu } from "./ComposerSuggestionMenu";
import type { TypeaheadItem } from "./typeahead";

export const handleTypeaheadKeys = ({
  event,
  typeaheadItems,
  typeaheadIndex,
  setTypeaheadIndex,
  applyTypeahead,
  dismiss,
}: {
  event: KeyboardEvent<HTMLTextAreaElement>;
  typeaheadItems: TypeaheadItem[];
  typeaheadIndex: number;
  setTypeaheadIndex: (updater: (index: number) => number) => void;
  applyTypeahead: (item: TypeaheadItem) => void;
  dismiss: () => void;
}): boolean => {
  if (typeaheadItems.length === 0) return false;
  if (handleTypeaheadNavigation(event, typeaheadItems.length, setTypeaheadIndex)) return true;
  if ((event.key === "Enter" || event.key === "Tab") && typeaheadIndex >= 0) {
    const item = typeaheadItems[typeaheadIndex];
    if (!item) return false;
    event.preventDefault();
    applyTypeahead(item);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    dismiss();
    return true;
  }
  return false;
};

export const TypeaheadPopover = ({
  items,
  activeIndex,
  onActiveIndexChange,
  onPick,
}: {
  items: TypeaheadItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (item: TypeaheadItem) => void;
}) => (
  <ComposerSuggestionMenu
    testId="composer-typeahead"
    ariaLabel="Repositories suggestions"
    heading="Repositories"
    items={items.map((item) => ({
      id: `${item.kind}-${item.id}`,
      label: item.label,
      description: "Repository",
      icon: <FolderGit2Icon className="size-4" />,
    }))}
    activeIndex={activeIndex}
    onActiveIndexChange={onActiveIndexChange}
    onPick={(index) => {
      const item = items[index];
      if (item) onPick(item);
    }}
  />
);

const handleTypeaheadNavigation = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  itemCount: number,
  setTypeaheadIndex: (updater: (index: number) => number) => void,
): boolean => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  event.preventDefault();
  const delta = event.key === "ArrowDown" ? 1 : -1;
  setTypeaheadIndex((index) => {
    if (index < 0) return delta > 0 ? 0 : itemCount - 1;
    return (index + delta + itemCount) % itemCount;
  });
  return true;
};
