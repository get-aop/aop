import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HouseIcon,
  RotateCwIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "../../components/IconButton";
import { displayAddress, resolveAddress } from "./address";

export interface AddressBarHandle {
  focus: () => void;
}

export interface ToolbarState {
  url: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The start page is shown (a new tab, or Home): there is no page to reload. */
  onStartPage: boolean;
}

/**
 * Back, forward, reload (stop while loading) and home, the address bar, and the page's developer
 * tools. Under them, a thin bar shows a page loading.
 */
export const BrowserToolbar = ({
  state,
  addressRef,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
  onHome,
  onDevtools,
  onEscape,
  children,
}: {
  state: ToolbarState;
  addressRef: Ref<AddressBarHandle>;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onHome: () => void;
  onDevtools: () => void;
  /** Escape in the address bar: back to the page. */
  onEscape: () => void;
  /** More buttons at the end (downloads). */
  children?: React.ReactNode;
}) => (
  <div className="relative flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-2">
    <IconButton
      testId="browser-back"
      label="Back (⌘[)"
      disabled={!state.canGoBack}
      onClick={onBack}
    >
      <ArrowLeftIcon />
    </IconButton>
    <IconButton
      testId="browser-forward"
      label="Forward (⌘])"
      disabled={!state.canGoForward}
      onClick={onForward}
    >
      <ArrowRightIcon />
    </IconButton>
    {state.loading ? (
      <IconButton testId="browser-stop" label="Stop loading" onClick={onStop}>
        <XIcon />
      </IconButton>
    ) : (
      <IconButton
        testId="browser-reload"
        label="Reload (⌘R)"
        disabled={state.onStartPage}
        onClick={onReload}
      >
        <RotateCwIcon />
      </IconButton>
    )}
    <IconButton testId="browser-home" label="Start page" onClick={onHome}>
      <HouseIcon />
    </IconButton>
    <AddressBar
      handleRef={addressRef}
      url={state.onStartPage ? null : state.url}
      onNavigate={onNavigate}
      onEscape={onEscape}
    />
    <IconButton
      testId="browser-devtools"
      label="Developer tools (⌥⌘I)"
      disabled={state.onStartPage}
      onClick={onDevtools}
    >
      <SquareTerminalIcon />
    </IconButton>
    {children}
    <LoadingBar loading={state.loading} />
  </div>
);

const AddressBar = ({
  handleRef,
  url,
  onNavigate,
  onEscape,
}: {
  handleRef: Ref<AddressBarHandle>;
  url: string | null;
  onNavigate: (url: string) => void;
  onEscape: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? displayAddress(url);

  useImperativeHandle(handleRef, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  // A new page replaces whatever was half typed for the old one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the address changing is the trigger
  useEffect(() => setDraft(null), [url]);

  return (
    <form
      className="mx-1 flex min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        const target = resolveAddress(shown);
        if (!target) return;
        setDraft(null);
        onNavigate(target);
      }}
    >
      <input
        ref={inputRef}
        data-testid="browser-address"
        aria-label="Address or search"
        placeholder="Search or type an address"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setDraft(null);
          onEscape();
        }}
        className="h-7 min-w-0 flex-1 rounded-row border border-border bg-input-surface px-2.5 text-meta text-text outline-none placeholder:text-text-subtle focus:border-running"
      />
    </form>
  );
};

/**
 * Electron reports no loading progress, so the bar eases most of the way while the page loads
 * and fills when it is done: the feel of Chrome's without its numbers.
 */
const LoadingBar = ({ loading }: { loading: boolean }) => {
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  useEffect(() => {
    if (loading) {
      setPhase("loading");
      return;
    }
    setPhase((current) => (current === "loading" ? "done" : current));
    const timer = setTimeout(() => setPhase("idle"), 250);
    return () => clearTimeout(timer);
  }, [loading]);
  return (
    <span
      data-testid="browser-loading-bar"
      data-loading={loading}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute bottom-[-1px] left-0 h-0.5 bg-running",
        phase === "idle" && "w-0 opacity-0",
        phase === "loading" && "w-[85%] opacity-100 transition-[width] duration-[8000ms] ease-out",
        phase === "done" && "w-full opacity-0 transition-[width,opacity] duration-200",
      )}
    />
  );
};
