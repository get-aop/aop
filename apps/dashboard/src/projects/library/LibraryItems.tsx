import type { LibraryItem } from "@aop/common";
import { ArrowDownIcon, ArrowUpIcon, FolderIcon, PinIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { loadApiImage } from "../../api/attachments";
import { libraryContentPath } from "../../api/library";
import { useNow } from "../use-now";
import { FileKindIcon } from "./file-icon";
import { type ItemAction, ItemMenu } from "./ItemMenu";
import {
  expiresSoon,
  expiryLabel,
  formatAdded,
  formatBytes,
  kindOf,
  type LibraryFolder,
  type LibrarySort,
} from "./library-view";

export type LibraryLayout = "list" | "grid";

interface ItemsProps {
  projectId: string;
  folders: readonly LibraryFolder[];
  items: readonly LibraryItem[];
  /** Matches from every folder: each row names its folder. */
  flat: boolean;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  onOpenFolder: (path: string) => void;
  onAction: (action: ItemAction, item: LibraryItem) => void;
}

export const LibraryItems = ({ layout, ...props }: ItemsProps & { layout: LibraryLayout }) =>
  layout === "grid" ? <ItemsGrid {...props} /> : <ItemsList {...props} />;

const ItemsList = ({ folders, items, flat, sort, onSort, onOpenFolder, onAction }: ItemsProps) => {
  const now = useNow();
  return (
    <div data-testid="library-list" className="@container flex flex-col px-2 pb-4">
      <div className="sticky top-0 z-10 flex h-8 items-center gap-3 rounded-row bg-raised px-3 text-meta text-text-subtle">
        <SortHeader label="Name" sort={sort} onSort={onSort} asc="name" className="flex-1" />
        <SortHeader
          label="Size"
          sort={sort}
          onSort={onSort}
          asc="smallest"
          desc="largest"
          className="hidden w-16 justify-end @sm:flex"
        />
        <SortHeader
          label="Added"
          sort={sort}
          onSort={onSort}
          asc="oldest"
          desc="newest"
          className="hidden w-20 justify-end @md:flex"
        />
        <span className="w-8" />
      </div>
      {folders.map((folder) => (
        <button
          key={folder.path}
          type="button"
          data-testid="library-folder"
          data-folder={folder.path}
          onClick={() => onOpenFolder(folder.path)}
          className="flex h-10 items-center gap-3 rounded-row px-3 text-left text-body hover:bg-hover"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
            <span className="truncate text-text">{folder.name}</span>
            <span className="shrink-0 text-meta text-text-subtle">{folder.count}</span>
          </span>
          <span className="hidden w-16 text-right text-meta text-text-subtle @sm:block">
            {formatBytes(folder.size)}
          </span>
          <span className="hidden w-20 text-right text-meta text-text-subtle @md:block">
            {formatAdded(folder.latest, now)}
          </span>
          <span className="w-8" />
        </button>
      ))}
      {items.map((item) => (
        <div
          key={item.id}
          data-testid="library-item"
          data-item-id={item.id}
          data-pinned={item.pinned}
          className="group flex min-h-10 items-center gap-3 rounded-row pr-3 hover:bg-hover"
        >
          <button
            type="button"
            data-testid="library-item-open"
            onClick={() => onAction("open", item)}
            className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-row py-1 pl-3 text-left focus-visible:bg-hover focus-visible:outline-none"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <FileKindIcon kind={kindOf(item)} className="size-4" />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-body text-text" title={item.name}>
                    {item.name}
                  </span>
                  {item.pinned ? (
                    <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-text-muted" />
                  ) : null}
                </span>
                <ItemSubline item={item} flat={flat} now={now} />
              </span>
            </span>
            <span className="hidden w-16 text-right text-meta text-text-subtle tabular-nums @sm:block">
              {formatBytes(item.size)}
            </span>
            <span
              className="hidden w-20 text-right text-meta text-text-subtle @md:block"
              title={new Date(item.createdAt).toLocaleString()}
            >
              {formatAdded(item.createdAt, now)}
            </span>
          </button>
          <ItemMenu item={item} onAction={onAction} />
        </div>
      ))}
    </div>
  );
};

// Under the name: its folder when results come from every folder, and when retention takes it.
const ItemSubline = ({ item, flat, now }: { item: LibraryItem; flat: boolean; now: number }) => {
  const expiry = expiryLabel(item, now);
  if (!flat && !expiry) return null;
  return (
    <span className="flex min-w-0 items-center gap-2 text-meta text-text-subtle">
      {flat ? <span className="truncate">{item.folder || "Library"}</span> : null}
      {expiry ? (
        <span
          data-testid="library-item-expiry"
          className={cn("shrink-0", expiresSoon(item, now) && "text-waiting")}
        >
          {expiry}
        </span>
      ) : null}
    </span>
  );
};

const SortHeader = ({
  label,
  sort,
  onSort,
  asc,
  desc,
  className,
}: {
  label: string;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  asc: LibrarySort;
  desc?: LibrarySort;
  className?: string;
}) => {
  const direction = sortDirection(sort, asc, desc);
  // Size and date open largest and newest first; name is A to Z.
  const next = desc && sort === desc ? asc : (desc ?? asc);
  const Arrow = direction === "ascending" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      data-testid={`library-sort-${label.toLowerCase()}`}
      data-direction={direction}
      aria-label={`Sort by ${label.toLowerCase()}`}
      onClick={() => onSort(next)}
      className={cn(
        "flex items-center gap-1 hover:text-text",
        direction !== "none" && "font-medium text-text-muted",
        className,
      )}
    >
      {label}
      {direction === "none" ? null : <Arrow aria-hidden="true" className="size-3" />}
    </button>
  );
};

const sortDirection = (
  sort: LibrarySort,
  asc: LibrarySort,
  desc: LibrarySort | undefined,
): "ascending" | "descending" | "none" => {
  if (sort === asc) return "ascending";
  return sort === desc ? "descending" : "none";
};

const ItemsGrid = ({ projectId, folders, items, flat, onOpenFolder, onAction }: ItemsProps) => {
  const now = useNow();
  return (
    <div
      data-testid="library-grid"
      className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2.5 px-3 pb-4"
    >
      {folders.map((folder) => (
        <button
          key={folder.path}
          type="button"
          data-testid="library-folder"
          data-folder={folder.path}
          onClick={() => onOpenFolder(folder.path)}
          className="flex flex-col overflow-hidden rounded-card border border-border bg-raised/40 text-left hover:border-border-strong hover:bg-hover"
        >
          <span className="grid aspect-[4/3] place-items-center bg-raised">
            <FolderIcon aria-hidden="true" className="size-10 text-text-muted" />
          </span>
          <span className="flex flex-col gap-0.5 px-2.5 py-2">
            <span className="truncate text-meta font-medium text-text">{folder.name}</span>
            <span className="text-[11.5px] text-text-subtle">
              {folder.count === 1 ? "1 file" : `${folder.count} files`} · {formatBytes(folder.size)}
            </span>
          </span>
        </button>
      ))}
      {items.map((item) => (
        <GridTile
          key={item.id}
          projectId={projectId}
          item={item}
          flat={flat}
          now={now}
          onAction={onAction}
        />
      ))}
    </div>
  );
};

const GridTile = ({
  projectId,
  item,
  flat,
  now,
  onAction,
}: {
  projectId: string;
  item: LibraryItem;
  flat: boolean;
  now: number;
  onAction: (action: ItemAction, item: LibraryItem) => void;
}) => {
  const expiry = expiryLabel(item, now);
  return (
    <div
      data-testid="library-item"
      data-item-id={item.id}
      data-pinned={item.pinned}
      className="group relative flex flex-col overflow-hidden rounded-card border border-border bg-raised/40 hover:border-border-strong hover:bg-hover has-[button:focus-visible]:border-running"
    >
      <button
        type="button"
        data-testid="library-item-open"
        onClick={() => onAction("open", item)}
        className="flex flex-col text-left focus-visible:outline-none"
      >
        <span className="grid aspect-[4/3] place-items-center overflow-hidden bg-raised">
          {kindOf(item) === "image" ? (
            <Thumbnail projectId={projectId} item={item} />
          ) : (
            <FileKindIcon kind={kindOf(item)} className="size-10" />
          )}
        </span>
        <span className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="flex items-center gap-1">
            <span className="truncate text-meta font-medium text-text" title={item.name}>
              {item.name}
            </span>
            {item.pinned ? (
              <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-text-muted" />
            ) : null}
          </span>
          <span className="truncate text-[11.5px] text-text-subtle">
            {flat ? `${item.folder || "Library"} · ` : ""}
            {formatBytes(item.size)}
          </span>
          {expiry ? (
            <span
              data-testid="library-item-expiry"
              className={cn(
                "truncate text-[11.5px] text-text-subtle",
                expiresSoon(item, now) && "text-waiting",
              )}
            >
              {expiry}
            </span>
          ) : null}
        </span>
      </button>
      <ItemMenu
        item={item}
        onAction={onAction}
        className="absolute top-1.5 right-1.5 bg-surface/90 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
      />
    </div>
  );
};

const Thumbnail = ({ projectId, item }: { projectId: string; item: LibraryItem }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    loadApiImage(libraryContentPath(projectId, item.id)).then(
      (loaded) => current && setUrl(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [projectId, item.id]);
  return url ? (
    <img
      src={url}
      alt=""
      data-testid="library-thumbnail"
      className="size-full object-cover"
      loading="lazy"
    />
  ) : (
    <FileKindIcon kind="image" className="size-10" />
  );
};
