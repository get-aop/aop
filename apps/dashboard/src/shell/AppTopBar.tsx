import { ShellNav } from "./ShellNav";
import { ShellStatus } from "./ShellStatus";

/**
 * The top bar of a screen with no project open (all projects, a project that is loading or
 * gone): the same start and end as a project's, with the switcher asking for a project.
 */
export const AppTopBar = () => (
  <header
    data-testid="app-topbar"
    className="@container flex h-pane-header min-w-0 shrink-0 items-center gap-2 px-2 shadow-[inset_0_-1px_0_var(--color-border)]"
  >
    <ShellNav current={null} />
    <ShellStatus testId="app-topbar-status" />
  </header>
);
