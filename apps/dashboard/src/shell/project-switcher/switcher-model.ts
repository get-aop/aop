import type { ProjectEntry } from "../../projects/projects-state";
import { attentionOf, groupProjects, matchesProjectSearch } from "../../projects/selectors";

export interface SwitcherSection {
  id: "pinned" | "projects" | "archived";
  label: string;
  entries: ProjectEntry[];
}

/**
 * The switcher's list for `query`: pinned projects first, then the others, then the archived
 * ones, each newest first (the order the projects page uses), keeping only the projects whose
 * name or goal matches. A section with nothing in it is left out.
 */
export const switcherSections = (
  entries: readonly ProjectEntry[],
  pinnedIds: readonly string[],
  query: string,
): SwitcherSection[] => {
  const groups = groupProjects(entries, pinnedIds);
  const sections: SwitcherSection[] = [
    { id: "pinned", label: "Pinned", entries: groups.pinned },
    { id: "projects", label: "Projects", entries: groups.active },
    { id: "archived", label: "Archived", entries: groups.archived },
  ];
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => matchesProjectSearch(entry, query)),
    }))
    .filter((section) => section.entries.length > 0);
};

/**
 * Whether a project other than the open one has a thread waiting on the person: the switcher
 * then carries a dot, so it is noticed from any screen.
 */
export const othersWaiting = (
  entries: readonly ProjectEntry[],
  currentId: string | null,
): boolean =>
  entries.some((entry) => entry.project.id !== currentId && attentionOf(entry.threads).waiting > 0);
