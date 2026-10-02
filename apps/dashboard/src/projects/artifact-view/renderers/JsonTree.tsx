import {
  CheckIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  LinkIcon,
  SearchIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useCopied } from "../use-copied";
import {
  entriesOf,
  formatJsonPath,
  type JsonPath,
  pathKey,
  pathsToDepth,
  searchJson,
} from "./json-path";

/** How deep the tree opens when it is first shown. */
const INITIAL_DEPTH = 2;
/** A container longer than this shows its first entries and a "show more". */
const PAGE = 200;

/**
 * JSON as a tree: containers fold, a search opens the tree down to every key or value that
 * matches and counts them, and each row copies its path (`$.items[3].name`) or its value.
 */
export const JsonTree = ({ value }: { value: unknown }) => {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState(() => pathsToDepth(value, INITIAL_DEPTH - 1));
  const search = useMemo(() => searchJson(value, query), [value, query]);
  // A search opens the tree down to what it found; the person can fold it again.
  useEffect(() => {
    if (search.open.size > 0) setOpened((current) => new Set([...current, ...search.open]));
  }, [search]);
  const toggle = useCallback(
    (key: string) =>
      setOpened((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  return (
    <div data-testid="artifact-json" className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-canvas/95 px-4 py-2 backdrop-blur">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-row border border-border bg-input-surface px-2.5 text-meta focus-within:border-border-strong">
          <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
          <input
            data-testid="json-search"
            aria-label="Search keys and values"
            placeholder="Search keys and values"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-subtle"
          />
          {query.trim() ? (
            <span
              data-testid="json-search-count"
              className="shrink-0 tabular-nums text-text-subtle"
            >
              {search.matches.size} {search.matches.size === 1 ? "match" : "matches"}
            </span>
          ) : null}
        </label>
        <button
          type="button"
          data-testid="json-expand-all"
          title="Expand all"
          aria-label="Expand all"
          onClick={() => setOpened(pathsToDepth(value, Number.POSITIVE_INFINITY))}
          className="grid size-8 place-items-center rounded-row text-text-subtle hover:bg-hover hover:text-text"
        >
          <ChevronsUpDownIcon className="size-4" />
        </button>
        <button
          type="button"
          data-testid="json-collapse-all"
          title="Collapse all"
          aria-label="Collapse all"
          onClick={() => setOpened(new Set([pathKey([])]))}
          className="grid size-8 place-items-center rounded-row text-text-subtle hover:bg-hover hover:text-text"
        >
          <ChevronsDownUpIcon className="size-4" />
        </button>
      </div>
      <div className="px-3 py-3 font-mono text-[13px] leading-6">
        <JsonNode
          path={[]}
          name={null}
          value={value}
          open={opened}
          matches={search.matches}
          onToggle={toggle}
        />
      </div>
    </div>
  );
};

interface NodeProps {
  path: JsonPath;
  name: string | number | null;
  value: unknown;
  open: ReadonlySet<string>;
  matches: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

const JsonNode = memo(function JsonNode(props: NodeProps) {
  const { path, value, open } = props;
  const container = value !== null && typeof value === "object";
  const isOpen = container && open.has(pathKey(path));
  return (
    <div>
      <JsonRow {...props} container={container} isOpen={isOpen} />
      {isOpen ? <JsonChildren {...props} value={value as object} /> : null}
    </div>
  );
});

const JsonRow = ({
  path,
  name,
  value,
  matches,
  onToggle,
  container,
  isOpen,
}: NodeProps & { container: boolean; isOpen: boolean }) => {
  const key = pathKey(path);
  return (
    <div
      data-testid="json-row"
      data-path={formatJsonPath(path)}
      data-match={matches.has(key) ? "true" : undefined}
      className={cn(
        "group/row flex min-w-0 items-center gap-1 rounded-sm pr-1 hover:bg-hover",
        matches.has(key) && "bg-waiting/15",
      )}
      style={{ paddingLeft: `${Math.max(0, path.length - 1) * 16}px` }}
    >
      {container ? (
        <button
          type="button"
          data-testid="json-toggle"
          aria-label={isOpen ? "Collapse" : "Expand"}
          aria-expanded={isOpen}
          onClick={() => onToggle(key)}
          className="grid size-5 shrink-0 place-items-center text-text-subtle hover:text-text"
        >
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", isOpen && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      {name !== null ? <KeyLabel name={name} /> : null}
      <span className="min-w-0 truncate">
        {container ? <Summary value={value as object} open={isOpen} /> : <Scalar value={value} />}
      </span>
      <RowActions path={path} value={value} />
    </div>
  );
};

const KeyLabel = ({ name }: { name: string | number }) => (
  <span className={cn("shrink-0", typeof name === "number" ? "text-text-subtle" : "text-running")}>
    {typeof name === "number" ? name : JSON.stringify(name)}
    <span className="text-text-subtle">: </span>
  </span>
);

// A long container shows a page of its entries at a time.
const JsonChildren = ({ path, value, open, matches, onToggle }: NodeProps & { value: object }) => {
  const [shown, setShown] = useState(PAGE);
  const entries = entriesOf(value);
  return (
    <div>
      {entries.slice(0, shown).map(([childName, child]) => (
        <JsonNode
          key={String(childName)}
          path={[...path, childName]}
          name={childName}
          value={child}
          open={open}
          matches={matches}
          onToggle={onToggle}
        />
      ))}
      {entries.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((count) => count + PAGE)}
          className="text-meta text-text-subtle hover:text-text"
          style={{ marginLeft: `${path.length * 16 + 24}px` }}
        >
          Show {Math.min(PAGE, entries.length - shown)} more of {entries.length - shown}
        </button>
      ) : null}
    </div>
  );
};

const Summary = ({ value, open }: { value: object; open: boolean }) => {
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  const [start, end] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  const noun = Array.isArray(value) ? "item" : "key";
  return (
    <span className="text-text-subtle">
      {start}
      {open ? null : (
        <>
          {" "}
          {count} {count === 1 ? noun : `${noun}s`} {end}
        </>
      )}
    </span>
  );
};

const Scalar = ({ value }: { value: unknown }) => {
  if (typeof value === "string") return <span className="text-ok">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-waiting">{value}</span>;
  if (typeof value === "boolean") return <span className="text-merged">{String(value)}</span>;
  return <span className="text-text-subtle">null</span>;
};

const RowActions = ({ path, value }: { path: JsonPath; value: unknown }) => {
  const [pathCopied, copyPath] = useCopied();
  const [valueCopied, copyValue] = useCopied();
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        data-testid="json-copy-path"
        title={pathCopied ? "Copied" : `Copy path ${formatJsonPath(path)}`}
        aria-label="Copy path"
        onClick={() => void copyPath(formatJsonPath(path))}
        className="grid size-5 place-items-center rounded-sm text-text-subtle hover:text-text"
      >
        {pathCopied ? <CheckIcon className="size-3 text-ok" /> : <LinkIcon className="size-3" />}
      </button>
      <button
        type="button"
        data-testid="json-copy-value"
        title={valueCopied ? "Copied" : "Copy value"}
        aria-label="Copy value"
        onClick={() =>
          void copyValue(typeof value === "string" ? value : JSON.stringify(value, null, 2))
        }
        className="grid h-5 place-items-center rounded-sm px-1 font-sans text-[11px] text-text-subtle hover:text-text"
      >
        {valueCopied ? <CheckIcon className="size-3 text-ok" /> : "Copy"}
      </button>
    </span>
  );
};
