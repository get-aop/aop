import type { TerminalLine } from "@aop/common";
import {
  CircleCheckIcon,
  CircleIcon,
  ClockIcon,
  FileDiffIcon,
  ListChecksIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";

export type RightPanelTab = "diff" | "tasks" | "checks" | "log";

const TABS: Array<{ id: RightPanelTab; label: string; icon: typeof FileDiffIcon }> = [
  { id: "diff", label: "Diff", icon: FileDiffIcon },
  { id: "tasks", label: "Tasks", icon: ListChecksIcon },
  { id: "checks", label: "Checks", icon: ShieldCheckIcon },
  { id: "log", label: "Log", icon: ScrollTextIcon },
];

/**
 * The right panel chrome (PLAN §6.3): resizable 400px column with pill tabs.
 * Content is provided by the sessions workspace per tab. Sheet fallback for
 * narrow viewports lives at the call site (ui/sheet).
 */
export const RightPanel = ({
  tab,
  onTabChange,
  onClose,
  tasksBadge,
  children,
}: {
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onClose: () => void;
  tasksBadge?: number;
  children: (tab: RightPanelTab) => React.ReactNode;
}) => (
  <div data-testid="right-panel" className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as RightPanelTab)}
        className="min-w-0 flex-1"
      >
        <TabsList className="w-full justify-start gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="relative gap-1.5 px-2.5">
              <Icon className="size-3.5" strokeWidth={1.7} />
              {label}
              {id === "tasks" && tasksBadge ? (
                <span
                  data-testid="tasks-tab-badge"
                  className="rounded-full bg-text px-1.5 text-[10px] font-semibold text-canvas"
                >
                  {tasksBadge}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <button
        type="button"
        data-testid="right-panel-close"
        aria-label="Close right panel"
        onClick={onClose}
        className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">{children(tab)}</div>
  </div>
);

/** Checks pane: gh checks grouped by workflow (existing SessionChecksPopup data). */
export const ChecksPane = ({
  checks,
  prTitle,
}: {
  checks: Array<{
    workflow: string;
    name: string;
    state: "success" | "failure" | "pending" | "skipped";
    startedAt: string | null;
    completedAt: string | null;
  }>;
  prTitle: string | null;
}) => {
  if (checks.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{prTitle ? "No checks reported" : "No pull request"}</EmptyTitle>
          <EmptyDescription>
            {prTitle
              ? "This pull request has no reported checks."
              : "Create a pull request to see checks."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const groups = new Map<string, typeof checks>();
  for (const check of checks) {
    const group = groups.get(check.workflow) ?? [];
    group.push(check);
    groups.set(check.workflow, group);
  }

  return (
    <div data-testid="checks-pane" className="flex flex-col gap-3 p-3">
      {prTitle ? <p className="truncate text-[12.5px] font-medium text-text">{prTitle}</p> : null}
      {[...groups.entries()].map(([workflow, rows]) => (
        <section key={workflow}>
          <h3 className="pb-1 text-[11.5px] font-semibold text-text-subtle">{workflow}</h3>
          <ul className="flex flex-col gap-1">
            {rows.map((check) => (
              <li
                key={`${check.workflow}:${check.name}`}
                data-state={check.state}
                className="flex items-center gap-2 rounded-control border border-border bg-raised px-2.5 py-1.5"
              >
                <CheckStateIcon state={check.state} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-text">{check.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-text-subtle">
                  <ClockIcon className="size-3" />
                  {checkDuration(check.startedAt, check.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

const CheckStateIcon = ({ state }: { state: "success" | "failure" | "pending" | "skipped" }) => {
  if (state === "success") return <CircleCheckIcon className="size-3.5 shrink-0 text-ok" />;
  if (state === "failure") {
    return (
      <span className="grid size-3.5 shrink-0 place-items-center rounded-full bg-blocked text-[8px] font-bold text-white">
        !
      </span>
    );
  }
  return <CircleIcon className="size-3.5 shrink-0 text-queued" />;
};

const checkDuration = (startedAt: string | null, completedAt: string | null): string => {
  if (!startedAt) return "—";
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  const total = Math.max(0, end - Date.parse(startedAt));
  const seconds = Math.round(total / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
};

/** Log pane: the runtime/work feed (terminal lines with their tones). */
export const LogPane = ({ lines }: { lines: TerminalLine[] }) => {
  if (lines.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No log entries</EmptyTitle>
          <EmptyDescription>Runtime output will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div data-testid="log-pane" className="flex flex-col gap-1 p-3">
      {lines.map((line, index) => (
        <div
          key={`${index}-${line.text}`}
          className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5"
          style={{
            color:
              line.tone === "cmd"
                ? "var(--color-running)"
                : line.tone === "meta"
                  ? "var(--color-text-subtle)"
                  : "var(--color-text)",
          }}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
};
