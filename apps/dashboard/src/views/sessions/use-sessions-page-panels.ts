import { useCallback, useState } from "react";

import type { RightPanelTab } from "../../workspace/right-panel";

interface RightPanelState {
  open: boolean;
  tab: RightPanelTab;
}

/** Right-panel state + actions (PLAN §4.2). */
export const useSessionsPagePanels = () => {
  const [rightPanel, setRightPanel] = useState<RightPanelState>({
    open: false,
    tab: "diff",
  });

  const closeRightPanel = useCallback(() => {
    setRightPanel((current) => ({ ...current, open: false }));
  }, []);
  const toggleRightPanel = useCallback(() => {
    setRightPanel((current) => ({ ...current, open: !current.open }));
  }, []);
  const setRightPanelTab = useCallback((tab: RightPanelTab) => {
    setRightPanel((current) => ({ ...current, tab, open: true }));
  }, []);

  return {
    rightPanel,
    closeRightPanel,
    toggleRightPanel,
    setRightPanelTab,
  };
};
