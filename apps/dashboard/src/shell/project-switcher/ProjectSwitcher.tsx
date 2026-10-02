import { ChevronsUpDownIcon, LayoutGridIcon, PlusIcon, Settings2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { useProjectsState } from "../../projects/ProjectsProvider";
import { ProjectTile } from "../../projects/ProjectTile";
import { usePinnedProjects } from "../../projects/project-preferences";
import type { ProjectEntry } from "../../projects/projects-state";
import {
  openNewProjectDialog,
  openSettingsDialog,
  setProjectSwitcherOpen,
  useDialogs,
} from "../dialog-store";
import { navigate, projectsPath, switchProjectPath, useRoute } from "../router";
import { SwitcherConnection } from "./SwitcherConnection";
import { SwitcherRow } from "./SwitcherRow";
import { othersWaiting, switcherSections } from "./switcher-model";

/**
 * The app's one menu, where the projects sidebar used to be: the chip in the top bar names the
 * open project, and opens (on a click or ⌘K) a list of every project with what waits in each, to
 * search and pick from with the keyboard, then New project, All projects and AOP settings. Its
 * dot says another project has something waiting on the person.
 */
export const ProjectSwitcher = ({ current }: { current: ProjectEntry | null }) => {
  const { byId } = useProjectsState();
  const { switcher: open } = useDialogs();
  const currentId = current?.project.id ?? null;
  const dot = useMemo(() => othersWaiting(Object.values(byId), currentId), [byId, currentId]);
  const label = dot
    ? "Switch project (⌘K). Another project is waiting on you"
    : "Switch project (⌘K)";
  // An action that opens a dialog keeps the focus there, not back on the chip.
  const keepFocus = useRef(false);

  return (
    <Popover open={open} onOpenChange={setProjectSwitcherOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="project-switcher"
          aria-label={label}
          aria-keyshortcuts="Meta+K"
          title={label}
          className="relative flex h-9 min-w-0 shrink items-center gap-2 overflow-hidden rounded-row px-1.5 hover:bg-hover data-[state=open]:bg-active"
        >
          <SwitcherChip current={current} />
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-text-subtle"
            strokeWidth={1.8}
          />
          {dot ? (
            <span
              data-testid="project-switcher-dot"
              aria-hidden="true"
              className="absolute top-1 left-1 size-2 rounded-full bg-running ring-2 ring-canvas"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="project-switcher-popover"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="flex w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          if (keepFocus.current) event.preventDefault();
          keepFocus.current = false;
        }}
      >
        {open ? (
          <SwitcherMenu
            currentId={currentId}
            close={(dialog) => {
              keepFocus.current = dialog;
              setProjectSwitcherOpen(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
};

/** What the chip shows: the open project, or an invitation to pick one. */
const SwitcherChip = ({ current }: { current: ProjectEntry | null }) => {
  if (!current) {
    return (
      <>
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-active text-text-muted">
          <LayoutGridIcon className="size-3.5" strokeWidth={1.8} />
        </span>
        <span
          data-testid="project-title"
          className="min-w-10 truncate text-body font-medium text-text-muted"
        >
          Select a project
        </span>
      </>
    );
  }
  const { project } = current;
  return (
    <>
      <ProjectTile project={project} />
      {/* The name alone gives way on a crowded bar, down to a few letters; the notices drop their words first. */}
      <span
        data-testid="project-title"
        className="min-w-10 truncate text-title font-semibold text-text"
      >
        {project.name}
      </span>
      {project.status !== "active" ? (
        <span
          data-testid="project-status-tag"
          className="shrink-0 rounded-md border border-border-strong px-1.5 text-xs font-medium capitalize text-text-muted"
        >
          {project.status}
        </span>
      ) : null}
    </>
  );
};

/**
 * The open popover: the search field (focused, so typing filters), the projects, and the app's
 * actions under them. Arrows, Enter and Escape are the command list's and the popover's own.
 */
const SwitcherMenu = ({
  currentId,
  close,
}: {
  currentId: string | null;
  /** `dialog`: the action opens a dialog, which keeps the focus. */
  close: (dialog: boolean) => void;
}) => {
  const state = useProjectsState();
  const route = useRoute();
  const { pinnedIds } = usePinnedProjects();
  const [query, setQuery] = useState("");
  const entries = Object.values(state.byId);
  const sections = useMemo(
    () => switcherSections(entries, pinnedIds, query),
    [entries, pinnedIds, query],
  );

  const pick = (projectId: string) => {
    close(false);
    if (projectId !== currentId) navigate(switchProjectPath(route, projectId));
  };

  return (
    <Command shouldFilter={false} loop label="Switch project" className="bg-transparent">
      <CommandInput
        data-testid="project-switcher-search"
        placeholder="Find a project…"
        value={query}
        onValueChange={setQuery}
        className="h-10 text-[13px]"
      />
      {/* The list holds the actions too, so the arrows reach them; only the projects scroll. */}
      <CommandList className="max-h-none overflow-visible">
        <div
          data-testid="project-switcher-list"
          className="max-h-[min(22rem,50vh)] overflow-y-auto"
        >
          <SwitcherNotice phase={state.phase} error={state.error} total={entries.length} />
          {state.phase === "ready" && entries.length > 0 && sections.length === 0 ? (
            <p
              data-testid="project-switcher-no-match"
              className="px-3 py-4 text-[12.5px] text-text-subtle"
            >
              No projects match “{query.trim()}”.
            </p>
          ) : null}
          {sections.map((section) => (
            <CommandGroup
              key={section.id}
              heading={section.label}
              data-testid={`project-switcher-${section.id}`}
              className="text-text"
            >
              {section.entries.map((entry) => (
                <SwitcherRow
                  key={entry.project.id}
                  entry={entry}
                  current={entry.project.id === currentId}
                  onSelect={() => pick(entry.project.id)}
                />
              ))}
            </CommandGroup>
          ))}
        </div>
        <CommandSeparator className="mx-0" />
        <CommandGroup data-testid="project-switcher-actions" className="text-text">
          <ActionItem
            value="action:new-project"
            testId="project-switcher-new-project"
            icon={<PlusIcon />}
            label="New project"
            shortcut="⌘N"
            onSelect={() => {
              close(true);
              openNewProjectDialog();
            }}
          />
          <ActionItem
            value="action:all-projects"
            testId="project-switcher-all-projects"
            icon={<LayoutGridIcon />}
            label="All projects"
            onSelect={() => {
              close(false);
              navigate(projectsPath());
            }}
          />
          <ActionItem
            value="action:settings"
            testId="project-switcher-settings"
            icon={<Settings2Icon />}
            label="AOP settings"
            shortcut="⌘,"
            onSelect={() => {
              close(true);
              openSettingsDialog("general");
            }}
          />
        </CommandGroup>
      </CommandList>
      <SwitcherConnection
        onAbout={() => {
          close(true);
          openSettingsDialog("about");
        }}
      />
    </Command>
  );
};

const SwitcherNotice = ({
  phase,
  error,
  total,
}: {
  phase: "loading" | "ready" | "error";
  error: string | null;
  total: number;
}) => {
  if (phase === "loading") {
    return <p className="px-3 py-4 text-[12.5px] text-text-subtle">Loading projects…</p>;
  }
  if (phase === "error") {
    return (
      <p data-testid="project-switcher-error" className="px-3 py-4 text-[12.5px] text-blocked">
        Could not load projects. {error}
      </p>
    );
  }
  if (total > 0) return null;
  return (
    <div data-testid="project-switcher-empty" className="flex flex-col gap-0.5 px-3 py-4">
      <p className="text-[13px] font-medium text-text">No projects yet</p>
      <p className="text-[12px] text-text-subtle">
        A project is one coordinator chat and the threads it starts.
      </p>
    </div>
  );
};

const ActionItem = ({
  value,
  testId,
  icon,
  label,
  shortcut,
  onSelect,
}: {
  value: string;
  testId: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect: () => void;
}) => (
  <CommandItem
    value={value}
    data-testid={testId}
    onSelect={onSelect}
    className={cn("h-8 gap-2.5 rounded-row text-[13px] text-text [&_svg]:text-text-muted")}
  >
    {icon}
    <span className="flex-1">{label}</span>
    {shortcut ? <kbd className="text-[11px] text-text-subtle">{shortcut}</kbd> : null}
  </CommandItem>
);
