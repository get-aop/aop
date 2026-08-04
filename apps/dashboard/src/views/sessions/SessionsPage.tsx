import type { Task } from "../../types";
import { useSessionsPageController } from "./sessions-page-controller";
import { SessionsPageView } from "./sessions-page-view";

export {
  abortActiveConversation,
  clampPanelWidth,
  MarkdownPanelSplitter,
  readStoredPanelWidth,
} from "./sessions-page-internals";

export interface SessionsPageProps {
  repos: Array<{ id: string; name: string | null; path: string }>;
  tasks?: Task[];
  focusTaskId?: string;
  onFocusTaskConsumed?: () => void;
  knownTaskIds?: string[];
  onNavigate: (path: string) => void;
  onAttachRepo?: () => void;
  onOpenWorkerDialog?: () => void;
}

export const SessionsPage = (props: SessionsPageProps) => {
  const viewModel = useSessionsPageController(props);
  return <SessionsPageView view={viewModel} />;
};
