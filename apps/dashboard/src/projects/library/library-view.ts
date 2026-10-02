import { type LibraryFileKind, type LibraryItem, libraryFileKind } from "@aop/common";

/** What the type filter offers; documents are markdown and plain text together. */
export const LIBRARY_TYPE_FILTERS = [
  { id: "all", label: "All types" },
  { id: "image", label: "Images" },
  { id: "pdf", label: "PDFs" },
  { id: "document", label: "Documents" },
  { id: "code", label: "Code" },
  { id: "other", label: "Other" },
] as const;
export type LibraryTypeFilter = (typeof LIBRARY_TYPE_FILTERS)[number]["id"];

export const LIBRARY_SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "largest", label: "Largest first" },
  { id: "smallest", label: "Smallest first" },
  { id: "name", label: "Name" },
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number]["id"];

export interface LibraryFolder {
  /** Its whole path, e.g. "Reports/Q3". */
  path: string;
  name: string;
  /** Files in it and in the folders inside it. */
  count: number;
  size: number;
  latest: string;
}

export interface LibraryView {
  folders: LibraryFolder[];
  items: LibraryItem[];
  /** Search or a type filter show matches from every folder, not the folders themselves. */
  flat: boolean;
}

export const kindOf = (item: Pick<LibraryItem, "mimeType" | "name">): LibraryFileKind =>
  libraryFileKind(item.mimeType, item.name);

/**
 * What the Library shows in `folder`: the folders right inside it and its own files, sorted.
 * With a search or a type filter it is the matching files of the whole Library instead.
 */
export const libraryView = (
  items: readonly LibraryItem[],
  {
    folder,
    search,
    type,
    sort,
  }: { folder: string; search: string; type: LibraryTypeFilter; sort: LibrarySort },
): LibraryView => {
  const query = search.trim().toLowerCase();
  if (query || type !== "all") {
    const matches = items.filter((item) => matchesType(item, type) && matchesSearch(item, query));
    return { folders: [], items: sortItems(matches, sort), flat: true };
  }
  return {
    folders: sortFolders(subfolders(items, folder), sort),
    items: sortItems(
      items.filter((item) => item.folder === folder),
      sort,
    ),
    flat: false,
  };
};

/** Every folder path the Library holds, parents included, for the Move dialog's suggestions. */
export const allFolders = (items: readonly LibraryItem[]): string[] => {
  const paths = new Set<string>();
  for (const item of items) {
    const segments = item.folder.split("/").filter(Boolean);
    for (let depth = 1; depth <= segments.length; depth++) {
      paths.add(segments.slice(0, depth).join("/"));
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
};

/** The crumbs of a folder path: the top, then each folder down to it. */
export const crumbsOf = (folder: string): { label: string; path: string }[] => {
  const segments = folder.split("/").filter(Boolean);
  return [
    { label: "Library", path: "" },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join("/"),
    })),
  ];
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until `expiresAt`, rounded up; 0 once it is due (the next cleanup takes it). */
export const daysLeft = (expiresAt: string, now: number): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / DAY_MS));

/** "Removed in 3 days", for an item retention will take; null for one it keeps. */
export const expiryLabel = (item: Pick<LibraryItem, "expiresAt">, now: number): string | null => {
  if (!item.expiresAt) return null;
  const days = daysLeft(item.expiresAt, now);
  if (days === 0) return "Removed at the next cleanup";
  return days === 1 ? "Removed in 1 day" : `Removed in ${days} days`;
};

/** Expiring soon enough to draw the eye. */
export const expiresSoon = (item: Pick<LibraryItem, "expiresAt">, now: number): boolean =>
  item.expiresAt !== null && daysLeft(item.expiresAt, now) <= 3;

export const SOURCE_LABEL: Record<LibraryItem["source"], string> = {
  artifact: "Saved by an agent",
  chat: "Sent in chat",
  upload: "Uploaded",
};

const matchesType = (item: LibraryItem, type: LibraryTypeFilter): boolean => {
  if (type === "all") return true;
  const kind = kindOf(item);
  return type === "document" ? kind === "markdown" || kind === "text" : kind === type;
};

const matchesSearch = (item: LibraryItem, query: string): boolean =>
  !query ||
  [item.name, item.folder, item.description].some((text) => text.toLowerCase().includes(query));

const subfolders = (items: readonly LibraryItem[], folder: string): LibraryFolder[] => {
  const prefix = folder ? `${folder}/` : "";
  const byName = new Map<string, LibraryFolder>();
  for (const item of items) {
    const name = childFolderName(item.folder, folder, prefix);
    if (!name) continue;
    const current = byName.get(name) ?? {
      path: `${prefix}${name}`,
      name,
      count: 0,
      size: 0,
      latest: item.createdAt,
    };
    current.count++;
    current.size += item.size;
    if (item.createdAt > current.latest) current.latest = item.createdAt;
    byName.set(name, current);
  }
  return [...byName.values()];
};

// The folder right inside `folder` that holds `itemFolder`, or null when it is not under it.
const childFolderName = (itemFolder: string, folder: string, prefix: string): string | null => {
  if (!itemFolder.startsWith(prefix) || itemFolder === folder) return null;
  return itemFolder.slice(prefix.length).split("/")[0] || null;
};

const sortItems = (items: LibraryItem[], sort: LibrarySort): LibraryItem[] =>
  [...items].sort((a, b) => compare(sort, a, b));

const sortFolders = (folders: LibraryFolder[], sort: LibrarySort): LibraryFolder[] =>
  [...folders].sort((a, b) =>
    compare(
      sort,
      { name: a.name, size: a.size, createdAt: a.latest },
      {
        name: b.name,
        size: b.size,
        createdAt: b.latest,
      },
    ),
  );

type Sortable = { name: string; size: number; createdAt: string };

const compare = (sort: LibrarySort, a: Sortable, b: Sortable): number => {
  const byName = a.name.localeCompare(b.name, undefined, { numeric: true });
  switch (sort) {
    case "newest":
      return b.createdAt.localeCompare(a.createdAt) || byName;
    case "oldest":
      return a.createdAt.localeCompare(b.createdAt) || byName;
    case "largest":
      return b.size - a.size || byName;
    case "smallest":
      return a.size - b.size || byName;
    case "name":
      return byName;
  }
};

const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "9:41 AM" today, "Oct 2" this year, "Oct 2, 2025" before. */
export const formatAdded = (iso: string, now: number): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return time.format(date);
  return date.getFullYear() === today.getFullYear() ? monthDay.format(date) : fullDay.format(date);
};
