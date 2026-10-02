import { type Dispatch, useEffect, useReducer } from "react";
import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/use-local-storage";
import {
  type BrowserTabsAction,
  type BrowserTabsState,
  browserTabsReducer,
  emptyTabs,
  parseSavedTabs,
} from "./tabs";

/** Where a project's tabs are kept: on this device, like the panel's width. */
export const browserTabsKey = (projectId: string): string => `aop:browser:v1:${projectId}`;

/** A project's tabs, read once when its browser first opens and saved on every change. */
export const useBrowserTabs = (
  projectId: string,
): [BrowserTabsState, Dispatch<BrowserTabsAction>] => {
  const [state, dispatch] = useReducer(
    browserTabsReducer,
    projectId,
    (id) => parseSavedTabs(getLocalStorageItem(browserTabsKey(id))) ?? emptyTabs(),
  );
  useEffect(() => setLocalStorageItem(browserTabsKey(projectId), state), [projectId, state]);
  return [state, dispatch];
};
