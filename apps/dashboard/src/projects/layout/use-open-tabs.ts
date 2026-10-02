import { useCallback, useEffect, useMemo } from "react";
import { useLocalStorage } from "../../hooks/use-local-storage";
import { navigate, projectPath, projectTabPath } from "../../shell/router";
import { type AddableTabId, isAddableTabId, type PanelTabId } from "./panel-tabs";

const NONE: string[] = [];
const storageKey = (projectId: string) => `aop:panel-tabs:v1:${projectId}`;

export interface OpenTabs {
  /** The tabs on the strip, Threads first, then the others in the order they were opened. */
  tabs: readonly PanelTabId[];
  /** Puts the tab on the strip (if it is not there yet) and shows it. */
  openTab: (tab: AddableTabId) => void;
  /** Takes the tab off the strip; closing the one showing goes back to Threads. */
  closeTab: (tab: AddableTabId) => void;
}

/**
 * Which of the panel's tabs a project has open. A per-device choice kept in local storage, like
 * the panel's width. A tab the address names (a link, a reload) is opened if it was not.
 */
export const useOpenTabs = (projectId: string, active: PanelTabId): OpenTabs => {
  const [stored, setStored] = useLocalStorage<string[]>(storageKey(projectId), NONE);
  const opened = useMemo(
    () => (Array.isArray(stored) ? stored.filter(isAddableTabId) : []),
    [stored],
  );

  useEffect(() => {
    if (active !== "threads" && !opened.includes(active)) {
      setStored((current) => [...validTabs(current), active]);
    }
  }, [active, opened, setStored]);

  const openTab = useCallback(
    (tab: AddableTabId) => {
      setStored((current) => {
        const tabs = validTabs(current);
        return tabs.includes(tab) ? tabs : [...tabs, tab];
      });
      navigate(projectTabPath(projectId, tab));
    },
    [projectId, setStored],
  );

  const closeTab = useCallback(
    (tab: AddableTabId) => {
      setStored((current) => validTabs(current).filter((id) => id !== tab));
      if (tab === active) navigate(projectPath(projectId));
    },
    [projectId, active, setStored],
  );

  const tabs = useMemo<PanelTabId[]>(() => ["threads", ...opened], [opened]);
  return { tabs, openTab, closeTab };
};

const validTabs = (value: unknown): AddableTabId[] =>
  Array.isArray(value) ? value.filter((id): id is AddableTabId => isAddableTabId(String(id))) : [];
