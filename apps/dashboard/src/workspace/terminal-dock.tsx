import type { TerminalLine } from "@aop/common";
import { SquareTerminalIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * THE terminal — a full-width bottom dock (PLAN §7.1), moved from the old
 * top drawer. Always-darkest surface, header = repo · worktree · branch in
 * mono, ⌘J / top-bar toggle. Same runChatSessionTerminal data flow.
 */
export const TerminalDock = ({
  ecmd,
  repoPath,
  branch,
  termLines,
  termInput,
  onTermInput,
  onTermRun,
  onTermClose,
}: {
  ecmd: string;
  repoPath: string;
  branch: string | null;
  termLines: TerminalLine[];
  termInput: string;
  onTermInput: (value: string) => void;
  onTermRun: () => void;
  onTermClose: () => void;
}) => {
  const termScrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when lines grow
  useEffect(() => {
    const el = termScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [termLines.length]);

  return (
    <div
      data-testid="terminal-dock"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-terminal"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <SquareTerminalIcon className="size-3.5 text-text-subtle" strokeWidth={1.7} />
        <span className="text-[11.5px] font-medium text-text-muted">Terminal</span>
        <span className="truncate font-mono text-[11px] text-text-subtle">
          {ecmd} · {repoPath}
          {branch ? ` · ${branch}` : ""}
        </span>
        <button
          type="button"
          onClick={onTermClose}
          title="Close terminal"
          aria-label="Close terminal"
          className="ml-auto grid size-6 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div
        ref={termScrollRef}
        className="aop-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2"
        id="aop-term-scroll"
        data-testid="terminal-lines"
      >
        {termLines.map((line, index) => (
          <div
            key={`${index}-${line.text}`}
            data-tone={line.tone}
            className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-text"
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
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <span className="font-mono text-[11.5px] font-semibold text-running">$</span>
        <input
          data-testid="terminal-input"
          value={termInput}
          onChange={(event) => onTermInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onTermRun();
            }
          }}
          placeholder={`run a command in ${repoPath}`}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-text outline-none placeholder:text-text-subtle"
        />
      </div>
    </div>
  );
};
