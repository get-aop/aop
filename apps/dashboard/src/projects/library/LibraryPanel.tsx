import type { LibraryItem } from "@aop/common";
import { FileUpIcon, FolderOpenIcon, LibraryIcon, SearchXIcon } from "lucide-react";
import { type DragEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { downloadLibraryItem } from "../../api/library";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { useLocalStorage } from "../../hooks/use-local-storage";
import type { ProjectEntry } from "../projects-state";
import { EditItemDialog, type EditMode } from "./EditItemDialog";
import type { ItemAction } from "./ItemMenu";
import { LibraryFooter } from "./LibraryFooter";
import { LibraryItems, type LibraryLayout } from "./LibraryItems";
import { LibraryPreview } from "./LibraryPreview";
import { LibraryToolbar } from "./LibraryToolbar";
import { allFolders, type LibrarySort, type LibraryTypeFilter, libraryView } from "./library-view";
import { showLibrarySource } from "./show-message";
import { useLibrary } from "./use-library";

/**
 * The Library tab: the project's files in folders. What agents saved (Artifacts), what the
 * person sent in its chats (Sent in chat) and what they added (Uploads, or any folder they drop
 * files on). Each file previews, downloads, renames, moves, pins and deletes, and links back to
 * the chat it came from; the footer shows the storage it uses against its caps.
 */
export const LibraryPanel = ({
  entry,
  revealChat,
}: {
  entry: ProjectEntry;
  /** Uncovers the coordinator chat where the panel covers it, for "Show message". */
  revealChat: () => void;
}) => {
  const projectId = entry.project.id;
  const library = useLibrary(projectId);
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<LibraryTypeFilter>("all");
  const [sort, setSort] = useLocalStorage<LibrarySort>("aop:library-sort:v1", "newest");
  const [layout, setLayout] = useLocalStorage<LibraryLayout>("aop:library-layout:v1", "list");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ item: LibraryItem; mode: EditMode } | null>(null);
  const [dragging, setDragging] = useState(false);

  const items = library.listing?.items ?? [];
  const view = useMemo(
    () => libraryView(items, { folder, search, type, sort }),
    [items, folder, search, type, sort],
  );
  const folders = useMemo(() => allFolders(items), [items]);
  const preview = items.find((item) => item.id === previewId) ?? null;
  const threadTitle = (item: LibraryItem | null) =>
    entry.threads.find((thread) => thread.id === item?.usedIn?.threadId)?.title;

  const showSource = useCallback(
    (item: LibraryItem) => {
      if (!item.usedIn) return;
      setPreviewId(null);
      showLibrarySource(projectId, item.usedIn, revealChat);
    },
    [projectId, revealChat],
  );

  const togglePin = useCallback(
    async (item: LibraryItem) => {
      if (await library.update(item, { pinned: !item.pinned })) {
        toast.success(
          item.pinned ? `Unpinned ${item.name}` : `Pinned ${item.name}: kept until you delete it`,
        );
      }
    },
    [library],
  );

  const onAction = useCallback(
    async (action: ItemAction, item: LibraryItem) => {
      switch (action) {
        case "open":
          return setPreviewId(item.id);
        case "download":
          return downloadLibraryItem(projectId, item).catch(() =>
            toast.error(`${item.name} could not be downloaded`),
          );
        case "rename":
        case "move":
          return setEdit({ item, mode: action });
        case "pin":
          return togglePin(item);
        case "source":
          return showSource(item);
        case "delete":
          if (await confirmDelete(item)) {
            await library.remove(item);
            if (previewId === item.id) setPreviewId(null);
          }
      }
    },
    [library, projectId, previewId, showSource, togglePin],
  );

  // A folder named in the path is where uploads land; the top level puts them in Uploads.
  const upload = (files: readonly File[]) => {
    if (files.length > 0) void library.upload(files, folder || undefined);
  };

  const dragProps = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      upload([...event.dataTransfer.files]);
    },
  };

  return (
    <div
      data-testid="library-panel"
      data-layout={layout}
      className="relative flex min-h-0 flex-1 flex-col"
      {...dragProps}
    >
      <LibraryToolbar
        folder={folder}
        onFolder={setFolder}
        search={search}
        onSearch={setSearch}
        type={type}
        onType={setType}
        sort={sort}
        onSort={setSort}
        layout={layout}
        onLayout={setLayout}
        uploading={library.uploading}
        onUpload={upload}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LibraryBody
          state={library}
          folder={folder}
          searching={search.trim() !== "" || type !== "all"}
          view={view}
          onOpenFolder={setFolder}
          onClearFilters={() => {
            setSearch("");
            setType("all");
          }}
        >
          <LibraryItems
            projectId={projectId}
            layout={layout}
            folders={view.folders}
            items={view.items}
            flat={view.flat}
            sort={sort}
            onSort={setSort}
            onOpenFolder={setFolder}
            onAction={(action, item) => void onAction(action, item)}
          />
        </LibraryBody>
      </div>
      {library.listing ? <LibraryFooter projectId={projectId} listing={library.listing} /> : null}
      {dragging ? <DropOverlay folder={folder} /> : null}
      <LibraryPreview
        projectId={projectId}
        item={preview}
        threadTitle={threadTitle(preview)}
        onClose={() => setPreviewId(null)}
        onTogglePin={(item) => void togglePin(item)}
        onShowSource={showSource}
      />
      <EditItemDialog
        edit={edit}
        folders={folders}
        onClose={() => setEdit(null)}
        onSave={(item, patch) => library.update(item, patch)}
      />
    </div>
  );
};

const LibraryBody = ({
  state,
  folder,
  searching,
  view,
  onOpenFolder,
  onClearFilters,
  children,
}: {
  state: ReturnType<typeof useLibrary>;
  folder: string;
  searching: boolean;
  view: ReturnType<typeof libraryView>;
  onOpenFolder: (folder: string) => void;
  onClearFilters: () => void;
  children: React.ReactNode;
}) => {
  if (!state.listing) {
    return state.error ? (
      <Empty data-testid="library-error">
        <EmptyHeader>
          <EmptyTitle>The Library could not be loaded</EmptyTitle>
          <EmptyDescription>{state.error}</EmptyDescription>
        </EmptyHeader>
        <Button variant="secondary" size="sm" onClick={() => void state.refresh()}>
          Try again
        </Button>
      </Empty>
    ) : (
      <div data-testid="library-loading" className="grid h-40 place-items-center">
        <Spinner />
      </div>
    );
  }
  if (state.listing.items.length === 0) {
    return (
      <Empty data-testid="library-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing in the Library yet</EmptyTitle>
          <EmptyDescription>
            Reports and files agents save, images you send in chat, and documents you add all land
            here. Drop files anywhere on this tab, or use Add.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (view.folders.length === 0 && view.items.length === 0) {
    return searching ? (
      <Empty data-testid="library-no-matches">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>No files match</EmptyTitle>
        </EmptyHeader>
        <Button variant="secondary" size="sm" onClick={onClearFilters}>
          Clear search and filters
        </Button>
      </Empty>
    ) : (
      <Empty data-testid="library-folder-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderOpenIcon />
          </EmptyMedia>
          <EmptyTitle>This folder is empty</EmptyTitle>
          <EmptyDescription>Drop files here to add them to {folder}.</EmptyDescription>
        </EmptyHeader>
        <Button variant="secondary" size="sm" onClick={() => onOpenFolder("")}>
          Back to the Library
        </Button>
      </Empty>
    );
  }
  return children;
};

const DropOverlay = ({ folder }: { folder: string }) => (
  <div
    data-testid="library-drop-overlay"
    className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-running bg-surface/90 text-body text-text"
  >
    <FileUpIcon aria-hidden="true" className="size-8 text-running" />
    Drop to add to {folder || "Uploads"}
  </div>
);

const hasFiles = (event: DragEvent): boolean => [...event.dataTransfer.types].includes("Files");

const confirmDelete = (item: LibraryItem): Promise<boolean> =>
  requestConfirmation({
    title: `Delete ${item.name}?`,
    message:
      item.source === "chat"
        ? "The file leaves the Library and the host. Its message stays, and shows the file as deleted."
        : "The file leaves the Library and the host. This cannot be undone.",
    confirmLabel: "Delete",
    destructive: true,
  });
