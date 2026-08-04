import { useCallback, useEffect, useState } from "react";

import type { RightPanelTab } from "../../workspace/right-panel";

interface RightPanelState {
  open: boolean;
  tab: RightPanelTab;
}

/** Right-panel state + actions and the ⌘J terminal toggle (PLAN §4.2). */
export const useSessionsPagePanels = () => {
  const [rightPanel, setRightPanel] = useState<RightPanelState>({
    open: false,
    tab: "diff",
  });
  const [termOpen, setTermOpen] = useState(false);

  const openRightPanel = useCallback((tab: RightPanelTab) => {
    setRightPanel({ open: true, tab });
  }, []);
  const closeRightPanel = useCallback(() => {
    setRightPanel((current) => ({ ...current, open: false }));
  }, []);
  const toggleRightPanel = useCallback(() => {
    setRightPanel((current) => ({ ...current, open: !current.open }));
  }, []);
  const setRightPanelTab = useCallback((tab: RightPanelTab) => {
    setRightPanel((current) => ({ ...current, tab, open: true }));
  }, []);

  // ⌘J toggles the terminal dock.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "j") {
        event.preventDefault();
        setTermOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    rightPanel,
    setRightPanel,
    termOpen,
    setTermOpen,
    openRightPanel,
    closeRightPanel,
    toggleRightPanel,
    setRightPanelTab,
  };
};
