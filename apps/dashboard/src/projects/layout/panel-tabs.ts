import { MessagesSquareIcon } from "lucide-react";

/**
 * The threads panel's sections. Threads is always there; every other tab is one the person
 * opens from the strip's "+" menu and can close again. A section added here gets a tab, an
 * entry in that menu, an address (`projectTabPath`) and a case in `PanelTabBody`.
 */
export const PANEL_TABS = [{ id: "threads", label: "Threads", icon: MessagesSquareIcon }] as const;

export type PanelTabSpec = (typeof PANEL_TABS)[number];
export type PanelTabId = PanelTabSpec["id"];
/** A tab the "+" menu opens: every one but Threads. */
export type AddableTabId = Exclude<PanelTabId, "threads">;

export const ADDABLE_TAB_IDS: readonly AddableTabId[] = PANEL_TABS.flatMap((tab) =>
  tab.id === "threads" ? [] : [tab.id as AddableTabId],
);

export const isAddableTabId = (value: string): value is AddableTabId =>
  (ADDABLE_TAB_IDS as readonly string[]).includes(value);

export const panelTabSpec = (id: PanelTabId): PanelTabSpec =>
  PANEL_TABS.find((tab) => tab.id === id) ?? PANEL_TABS[0];
