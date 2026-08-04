import { GitBranchIcon, PlusIcon } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

export interface BranchComboboxProps {
  branches: string[];
  selected: string;
  onSelect: (branch: string) => void;
  disabled: boolean;
  label?: string;
  id?: string;
  testId?: string;
}

export const BranchCombobox = ({
  branches,
  selected,
  onSelect,
  disabled,
  label = "BASE BRANCH",
  id = "branch-combobox",
  testId = "branch-combobox",
}: BranchComboboxProps) => {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selected);
  }, [selected]);

  const filtered = query
    ? branches.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
    : branches;

  const exactMatch = branches.includes(query);
  const showCreate = query.trim().length > 0 && !exactMatch;
  const totalOptions = filtered.length + (showCreate ? 1 : 0);

  const commitSelection = useCallback(
    (branch: string) => {
      onSelect(branch);
      setQuery(branch);
      setIsOpen(false);
      setHighlightIndex(-1);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlightIndex((prev) => {
          const next = prev + delta;
          if (next < 0) return totalOptions - 1;
          return next >= totalOptions ? 0 : next;
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        resolveEnterKey(highlightIndex, filtered, showCreate, query, commitSelection);
      }
    },
    [highlightIndex, filtered, showCreate, query, commitSelection, totalOptions],
  );

  useEffect(() => {
    if (!isOpen || highlightIndex < 0) return;
    const item = listRef.current?.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, isOpen]);

  useClickOutside(inputRef, listRef, isOpen, () => {
    setIsOpen(false);
    if (query.trim() && query !== selected) {
      onSelect(query.trim());
    }
  });

  return (
    <div className="relative">
      <label htmlFor={id} className="text-[11px] mb-1 block text-text-muted">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={branches.length > 0 ? "Search or type a branch..." : "Loading..."}
        disabled={disabled}
        autoComplete="off"
        data-testid={testId}
        className="focus-ring w-full rounded-control border border-border bg-raised px-3 py-1.5 font-mono text-[12px] text-text placeholder:text-text-subtle disabled:opacity-50"
      />

      {isOpen && totalOptions > 0 ? (
        <BranchDropdown
          ref={listRef}
          filtered={filtered}
          selected={selected}
          query={query}
          highlightIndex={highlightIndex}
          showCreate={showCreate}
          onSelect={commitSelection}
          onHighlight={setHighlightIndex}
        />
      ) : null}
    </div>
  );
};

interface BranchDropdownProps {
  filtered: string[];
  selected: string;
  query: string;
  highlightIndex: number;
  showCreate: boolean;
  onSelect: (branch: string) => void;
  onHighlight: (index: number) => void;
}

const BranchDropdown = forwardRef<HTMLDivElement, BranchDropdownProps>(
  ({ filtered, selected, query, highlightIndex, showCreate, onSelect, onHighlight }, ref) => (
    <div
      ref={ref}
      className="absolute z-[var(--z-menu)] mt-1 max-h-48 w-full overflow-auto rounded-control border border-border bg-surface shadow-2"
    >
      {filtered.map((branch, i) => (
        <button
          key={branch}
          type="button"
          tabIndex={-1}
          onMouseDown={() => onSelect(branch)}
          onMouseEnter={() => onHighlight(i)}
          className={`flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-mono text-[12px] ${
            highlightIndex === i ? "bg-raised text-text" : "text-text-muted hover:bg-raised"
          } ${branch === selected ? "text-favorite" : ""}`}
        >
          <GitBranchIcon className="size-3.5 shrink-0" strokeWidth={1.7} />
          {branch}
          {branch === selected ? (
            <span className="ml-auto text-[11.5px] font-medium text-text-subtle">current</span>
          ) : null}
        </button>
      ))}

      {showCreate ? (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={() => onSelect(query.trim())}
          onMouseEnter={() => onHighlight(filtered.length)}
          className={`flex w-full cursor-pointer items-center gap-2 border-x-0 border-b-0 border-t border-border bg-transparent px-3 py-1.5 text-left font-mono text-[12px] ${
            highlightIndex === filtered.length
              ? "bg-raised text-text"
              : "text-text-muted hover:bg-raised"
          }`}
        >
          <PlusIcon className="size-3.5 shrink-0" strokeWidth={1.7} />
          <span>
            Use "<span className="text-favorite">{query.trim()}</span>"
          </span>
        </button>
      ) : null}
    </div>
  ),
);

const useClickOutside = (
  inputRef: React.RefObject<HTMLElement | null>,
  listRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
) => {
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!inputRef.current?.contains(target) && !listRef.current?.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, inputRef, listRef, onClose]);
};

const resolveEnterKey = (
  highlightIndex: number,
  filtered: string[],
  showCreate: boolean,
  query: string,
  commit: (branch: string) => void,
) => {
  const highlighted = filtered[highlightIndex];
  if (highlighted !== undefined) {
    commit(highlighted);
  } else if (highlightIndex === filtered.length && showCreate) {
    commit(query.trim());
  } else if (query.trim()) {
    commit(query.trim());
  }
};
