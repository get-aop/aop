import type { PullRequestViewDetail, PullRequestViewFilesResponse } from "@aop/common";
import { FolderTreeIcon, SearchIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Skeleton } from "@/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { getPullRequestFiles, type PullRequestKey } from "../../api/pull-request-view";
import { useLocalStorage } from "../../hooks/use-local-storage";
import { plural } from "./bits";
import { EmptyTab } from "./ChecksTab";
import type { DiffStyle } from "./DiffList";
import { fileAnchor, filesInTreeOrder, fileTreeOf, MANY_FILES } from "./diff-files";
import { FileTree } from "./FileTree";

const DiffList = lazy(() => import("./DiffList"));

/**
 * The Files changed tab: the file tree, a filter, unified or split, and the diff of every file.
 * Files are asked for when the tab first opens, and again when the head moves. Large files and
 * very long lists start folded; the renderer virtualizes the rest.
 */
export const FilesTab = ({
  pullKey,
  detail,
}: {
  pullKey: PullRequestKey;
  detail: PullRequestViewDetail;
}) => {
  const files = usePullRequestFiles(pullKey, detail.headSha);
  const [diffStyle, setDiffStyle] = useLocalStorage<DiffStyle>("aop:pr-view:diff-style", "unified");
  const [treeOpen, setTreeOpen] = useLocalStorage<boolean>("aop:pr-view:file-tree", true);
  const [filter, setFilter] = useState("");
  const folding = useFolding(files.data);

  const shownFiles = useMemo(() => {
    const all = filesInTreeOrder(fileTreeOf(files.data?.files ?? []));
    const needle = filter.trim().toLowerCase();
    return needle ? all.filter((file) => file.path.toLowerCase().includes(needle)) : all;
  }, [files.data, filter]);
  const tree = useMemo(() => fileTreeOf(shownFiles), [shownFiles]);

  if (files.error) {
    return (
      <EmptyTab testId="pr-files-error" title="Could not load the files">
        {files.error}{" "}
        <button type="button" onClick={files.reload} className="text-running hover:underline">
          Try again
        </button>
      </EmptyTab>
    );
  }
  if (!files.data) return <FilesSkeleton />;
  if (files.data.files.length === 0) {
    return (
      <EmptyTab testId="pr-files-empty" title="No changes">
        This pull request changes no files.
      </EmptyTab>
    );
  }

  const jumpTo = (path: string) => {
    folding.open(path);
    window.requestAnimationFrame(() =>
      document.getElementById(fileAnchor(path))?.scrollIntoView({ block: "start" }),
    );
  };

  return (
    <section data-testid="pr-files-tab" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="pr-file-tree-toggle"
          aria-pressed={treeOpen}
          aria-label={treeOpen ? "Hide the file tree" : "Show the file tree"}
          title={treeOpen ? "Hide the file tree" : "Show the file tree"}
          onClick={() => setTreeOpen(!treeOpen)}
        >
          <FolderTreeIcon />
        </Button>
        <span className="text-meta text-text-muted" data-testid="pr-files-count">
          {plural(files.data.files.length, "file")} changed
          {files.data.truncated ? ` (GitHub lists the first ${files.data.files.length})` : ""}
        </span>
        <div className="relative ml-auto">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-subtle" />
          <Input
            data-testid="pr-files-filter"
            value={filter}
            aria-label="Filter files"
            placeholder="Filter files…"
            onChange={(event) => setFilter(event.target.value)}
            className="h-8 w-44 pl-7 text-meta"
          />
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={diffStyle}
          onValueChange={(value) => value && setDiffStyle(value as DiffStyle)}
          aria-label="Diff layout"
        >
          <ToggleGroupItem value="unified" data-testid="pr-diff-unified">
            Unified
          </ToggleGroupItem>
          <ToggleGroupItem value="split" data-testid="pr-diff-split">
            Split
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 flex-1">
        {treeOpen ? (
          <nav
            aria-label="Changed files"
            data-testid="pr-file-tree"
            className="w-48 shrink-0 overflow-auto border-r border-border py-2 @3xl:w-64"
          >
            <FileTree nodes={tree} onSelect={jumpTo} />
          </nav>
        ) : null}
        {shownFiles.length === 0 ? (
          <p className="flex-1 p-6 text-center text-meta text-text-muted">
            No file matches “{filter}”.
          </p>
        ) : (
          <Suspense fallback={<FilesSkeleton />}>
            <DiffList
              files={shownFiles}
              diffStyle={diffStyle}
              collapsed={folding.collapsed}
              shown={folding.shown}
              onToggle={folding.toggle}
              onShow={folding.show}
              githubUrl={detail.url}
            />
          </Suspense>
        )}
      </div>
    </section>
  );
};

/** The files of the pull request; read again when its head moves. */
const usePullRequestFiles = (key: PullRequestKey, headSha: string) => {
  const [data, setData] = useState<PullRequestViewFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { projectId, repoId, number } = key;

  useEffect(() => {
    void headSha;
    void attempt;
    let current = true;
    setError(null);
    getPullRequestFiles({ projectId, repoId, number }).then(
      (next) => current && setData(next),
      (failure: unknown) =>
        current && setError(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      current = false;
    };
  }, [projectId, repoId, number, headSha, attempt]);

  return { data, error, reload: useCallback(() => setAttempt((count) => count + 1), []) };
};

/**
 * Which files are folded and which large ones were asked for. A very long list starts with every
 * file folded; otherwise every file is open (a large one behind its "Load diff").
 */
const useFolding = (data: PullRequestViewFilesResponse | null) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const files = data?.files ?? [];
    setCollapsed(new Set(files.length > MANY_FILES ? files.map((file) => file.path) : []));
    setShown(new Set());
  }, [data]);

  const toggle = useCallback(
    (path: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return next;
      }),
    [],
  );
  const open = useCallback(
    (path: string) =>
      setCollapsed((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      }),
    [],
  );
  const show = useCallback((path: string) => setShown((current) => new Set(current).add(path)), []);
  return { collapsed, shown, toggle, open, show };
};

const FilesSkeleton = () => (
  <div data-testid="pr-files-loading" className={cn("flex flex-1 flex-col gap-3 p-3")}>
    {[0, 1, 2].map((row) => (
      <Skeleton key={row} className="h-24 w-full" />
    ))}
  </div>
);
