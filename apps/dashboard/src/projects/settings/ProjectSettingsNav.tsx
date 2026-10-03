import {
  BellIcon,
  BrainIcon,
  ChartLineIcon,
  CircleDotIcon,
  FolderGit2Icon,
  type LucideIcon,
  MonitorSmartphoneIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import { type KeyboardEvent, useCallback } from "react";
import { cn } from "@/lib/cn";
import { Link, type ProjectSettingsSection, projectSettingsPath } from "../../shell/router";

export const SECTIONS: Record<
  ProjectSettingsSection,
  { label: string; icon: LucideIcon; description: string }
> = {
  general: {
    label: "General",
    icon: SettingsIcon,
    description:
      "What the project is called, and what the coordinator and every thread are told about it.",
  },
  models: {
    label: "Models",
    icon: SparklesIcon,
    description:
      "Each role runs the model and effort you choose. “Default” passes none, so Claude Code picks its own and the role follows it when it changes; the label names what the last run used.",
  },
  threads: {
    label: "Threads & permissions",
    icon: ShieldCheckIcon,
    description:
      "What threads may do on this host without asking, and what the host does for them by itself.",
  },
  "computer-use": {
    label: "Computer use",
    icon: MonitorSmartphoneIcon,
    description:
      "Whether threads can see and operate apps and browsers on the AOP host. The coordinator never gets these tools.",
  },
  notifications: {
    label: "Notifications",
    icon: BellIcon,
    description: "When the desktop app tells you about this project.",
  },
  environment: {
    label: "Environment",
    icon: FolderGit2Icon,
    description: "The repositories this project's threads work in.",
  },
  issues: {
    label: "Issue sources",
    icon: CircleDotIcon,
    description:
      "Where the Issues tab lists issues from besides the repositories' GitHub issues. Keys and tokens stay on the host.",
  },
  memory: {
    label: "Memory",
    icon: BrainIcon,
    description: "What agents remember about this project from one session to the next.",
  },
  usage: {
    label: "Usage",
    icon: ChartLineIcon,
    description:
      "What this project has spent, in tokens, cost and code changes, and how much its Library keeps.",
  },
  advanced: {
    label: "Advanced",
    icon: SlidersHorizontalIcon,
    description: "Pause, restart or archive the project, or delete it.",
  },
};

/** The nav's groups: what a person sets, what the project holds, then the actions. */
const GROUPS: ProjectSettingsSection[][] = [
  ["general", "models", "threads", "computer-use", "notifications"],
  ["environment", "issues", "memory", "usage"],
  ["advanced"],
];

/**
 * A column of sections in three groups from md up. On a phone it is a row of tabs that scrolls
 * sideways and stops short of the ×; only the current tab keeps its name (the others are icons,
 * named in their tooltip). Arrow keys, Home and End move between the sections.
 */
export const ProjectSettingsNav = ({
  projectId,
  section,
}: {
  projectId: string;
  section: ProjectSettingsSection;
}) => {
  // On a phone the current tab can be past the edge; bring it into view as it becomes current.
  const current = useCallback((link: HTMLAnchorElement | null) => {
    link?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);

  return (
    <div className="flex shrink-0 flex-col border-b border-border pr-10 md:w-60 md:border-r md:border-b-0 md:pr-0">
      <p className="hidden px-5 pt-5 pb-2 text-[12px] text-text-subtle md:block">
        Project settings
      </p>
      <nav
        aria-label="Project settings"
        onKeyDown={moveFocus}
        className="flex gap-0.5 overflow-x-auto p-2 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-y-auto md:px-3"
      >
        {GROUPS.map((group, index) => (
          <div
            key={group[0]}
            className={cn(
              "flex shrink-0 gap-0.5 md:flex-col",
              index > 0 &&
                "border-l border-border pl-1 md:mt-2 md:border-t md:border-l-0 md:pt-2 md:pl-0",
            )}
          >
            {group.map((id) => (
              <NavLink
                key={id}
                id={id}
                projectId={projectId}
                current={id === section}
                linkRef={id === section ? current : undefined}
              />
            ))}
          </div>
        ))}
      </nav>
      <p className="hidden px-5 py-4 text-[11.5px] leading-relaxed text-text-subtle md:block">
        Changes save as you make them.
      </p>
    </div>
  );
};

const NavLink = ({
  id,
  projectId,
  current,
  linkRef,
}: {
  id: ProjectSettingsSection;
  projectId: string;
  current: boolean;
  linkRef?: React.Ref<HTMLAnchorElement>;
}) => {
  const { label, icon: Icon } = SECTIONS[id];
  return (
    <Link
      ref={linkRef}
      to={projectSettingsPath(projectId, id)}
      data-testid={`project-settings-nav-${id}`}
      data-nav-item=""
      aria-current={current ? "page" : undefined}
      aria-label={current ? undefined : label}
      title={current ? undefined : label}
      className={cn(
        "flex h-9 shrink-0 items-center gap-2.5 rounded-row px-2.5 text-[13.5px] outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring/60",
        current
          ? "bg-active text-text"
          : "text-text-muted hover:bg-hover hover:text-text max-md:w-9 max-md:justify-center max-md:px-0",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span
        data-testid="project-settings-nav-label"
        className={cn("truncate", !current && "max-md:hidden")}
      >
        {label}
      </span>
    </Link>
  );
};

const KEY_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
  const step = KEY_STEPS[event.key];
  if (!step) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-item]")];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  items[step(index, items.length)]?.focus();
};
