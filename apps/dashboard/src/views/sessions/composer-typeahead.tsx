import { CONTROL_COMMANDS, type ControlCapability } from "@aop/common";
import { BotIcon, FolderGit2Icon, UserRoundIcon, WorkflowIcon } from "lucide-react";
import { createElement, type KeyboardEvent, type ReactNode } from "react";
import { ComposerSuggestionMenu } from "./ComposerSuggestionMenu";
import type { TypeaheadItem, TypeaheadKind } from "./typeahead";

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
    ariaLabel={`${typeaheadHeading(items)} suggestions`}
    heading={typeaheadHeading(items)}
    items={items.map((item) => ({
      id: `${item.kind}-${item.id}`,
      label: item.label,
      description: typeaheadItemDescription(item),
      icon: typeaheadItemIcon(item),
    }))}
    activeIndex={activeIndex}
    onActiveIndexChange={onActiveIndexChange}
    onPick={(index) => {
      const item = items[index];
      if (item) onPick(item);
    }}
  />
);

const typeaheadItemIcon = (item: TypeaheadItem): ReactNode => {
  if (item.kind === "control") return controlTypeaheadIcon(item.id);
  const Icon = TYPEAHEAD_ICONS[item.kind];
  return createElement(Icon, { className: "size-4" });
};

const TYPEAHEAD_ICONS = {
  worker: UserRoundIcon,
  workflow: WorkflowIcon,
  repo: FolderGit2Icon,
  runtime: BotIcon,
} as const;

const typeaheadHeading = (items: TypeaheadItem[]): string => {
  const kind = items[0]?.kind;
  if (!kind) return "Suggestions";
  return TYPEAHEAD_HEADINGS[kind];
};

const TYPEAHEAD_HEADINGS: Record<TypeaheadKind, string> = {
  worker: "Workers",
  workflow: "Workflows",
  repo: "Repositories",
  control: "Controls",
  runtime: "Runtimes",
};

const typeaheadItemDescription = (item: TypeaheadItem): string => {
  if (item.kind === "workflow" && item.workflow) {
    return `${item.workflow.stepCount} ${item.workflow.stepCount === 1 ? "step" : "steps"}`;
  }
  if (item.kind === "control") {
    const command = CONTROL_COMMANDS.find(
      (entry) => entry.id.toLowerCase() === item.id.toLowerCase(),
    );
    return command ? `${command.capability} control` : "Control";
  }
  return TYPEAHEAD_DESCRIPTIONS[item.kind] ?? "Workflow";
};

const TYPEAHEAD_DESCRIPTIONS: Partial<Record<TypeaheadKind, string>> = {
  worker: "Worker",
  repo: "Repository",
  runtime: "Runtime",
};

const controlTypeaheadIcon = (itemId: string): ReactNode => {
  const command = CONTROL_COMMANDS.find((entry) => entry.id.toLowerCase() === itemId.toLowerCase());
  if (!command) return null;
  return capabilityGlyph(command.capability);
};

const capabilityGlyph = (capability: ControlCapability): ReactNode => {
  const paths =
    capability === "browser"
      ? (["M3 5h18v14H3z", "M3 9h18", "M7 7h.01"] as const)
      : (["M4 4h16v12H4z", "M8 20h8", "M12 16v4"] as const);
  return createElement(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
      style: { flexShrink: 0 },
    },
    ...paths.map((d) => createElement("path", { key: d, d })),
  );
};

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
