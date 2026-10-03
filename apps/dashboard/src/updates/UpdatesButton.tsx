import { ArrowUpCircleIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
import { formatAgo } from "../projects/selectors";
import { useNow } from "../projects/use-now";
import { openSettingsDialog } from "../shell/dialog-store";
import { appUpdateBridge } from "./app-update-store";
import { UpdateRow } from "./UpdateRow";
import { newsSignature, type UpdateRowView } from "./update-rows";
import { checkEverything, rereadEverything, useUpdateRows } from "./use-update-rows";

const SEEN_KEY = "aop:updates-seen:v1";

/**
 * The top bar's Updates button. It shows only when something can be updated, an update is
 * running or one failed, with a dot while there is news since the popover was last opened. While
 * the host updates it reads "Updating host…" on every device, whoever started it. It opens the
 * popover with one row per thing that updates: This app (desktop only), Host <name>, Agent CLIs.
 */
export const UpdatesButton = () => {
  const { host, rows, checking } = useUpdateRows({ poll: true });
  const open = usePopoverOpen();
  const [seen, setSeen] = useState(readSeen);
  useMenuOpensPopover();

  const news = newsSignature(rows);
  const hostUpdating = rows.some((row) => row.id === "host" && row.status === "Updating host…");
  if (!rows.some((row) => row.attention) && !open) return null;

  const onOpenChange = (next: boolean) => {
    setPopoverOpen(next);
    if (!next) return;
    setSeen(markSeen(news));
    void rereadEverything();
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="updates-button"
          aria-label={hostUpdating ? "Updating host…" : "Updates"}
          title={hostUpdating ? "Updating host…" : "Updates"}
          className={cn(
            "relative flex h-8 shrink-0 items-center gap-1.5 rounded-row px-1.5 text-meta transition-colors duration-[120ms] hover:bg-hover @md:px-2",
            hostUpdating ? "text-text" : "text-running",
          )}
        >
          {hostUpdating ? (
            <>
              <Spinner className="size-3.5" />
              <span data-testid="updates-host-chip">Updating host…</span>
            </>
          ) : (
            <ArrowUpCircleIcon className="size-4" strokeWidth={1.7} />
          )}
          {news !== seen && !hostUpdating ? (
            <span
              data-testid="updates-dot"
              aria-hidden="true"
              className="absolute top-1 right-1 size-1.5 rounded-full bg-running"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        data-testid="updates-popover"
        className="flex w-[380px] flex-col gap-0 p-0"
      >
        <UpdatesPanel
          rows={rows}
          checking={checking}
          checkedAt={host.status?.checkedAt ?? null}
          hostUpdating={hostUpdating}
          error={host.error}
        />
      </PopoverContent>
    </Popover>
  );
};

const UpdatesPanel = ({
  rows,
  checking,
  checkedAt,
  hostUpdating,
  error,
}: {
  rows: UpdateRowView[];
  checking: boolean;
  checkedAt: string | null;
  hostUpdating: boolean;
  error: string | null;
}) => {
  const now = useNow(30_000);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold text-text">Updates</span>
        <span className="text-[11.5px] text-text-subtle">
          {checkedAt ? `Checked ${formatAgo(checkedAt, now)}` : null}
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="ml-auto"
          data-testid="updates-check"
          disabled={checking}
          onClick={() => void checkEverything()}
        >
          {checking ? "Checking…" : "Check for updates"}
        </Button>
      </div>
      {error ? (
        <p role="alert" data-testid="updates-error" className="px-3 pt-2 text-[12px] text-blocked">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <UpdateRow key={row.id} row={row} compact />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-[11.5px] text-text-subtle">
        {hostUpdating ? <span>Projects reconnect when the host is back.</span> : null}
        <button
          type="button"
          data-testid="updates-settings-link"
          className="ml-auto text-running hover:underline"
          onClick={() => {
            setPopoverOpen(false);
            openSettingsDialog("updates");
          }}
        >
          Update settings
        </button>
      </div>
    </>
  );
};

// The popover's open state is the module's, so the desktop menu's "Check for Updates…" can open it.
let popoverOpen = false;
const openListeners = new Set<() => void>();

const usePopoverOpen = (): boolean =>
  useSyncExternalStore(
    (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    () => popoverOpen,
  );

export const setPopoverOpen = (open: boolean): void => {
  popoverOpen = open;
  for (const listener of openListeners) listener();
};

// The app menu's "Check for Updates…" checks every feed and opens the popover.
const useMenuOpensPopover = (): void => {
  useEffect(() => {
    const bridge = appUpdateBridge();
    return bridge?.onOpenUpdates?.(() => {
      setPopoverOpen(true);
      void checkEverything();
    });
  }, []);
};

const readSeen = (): string => {
  try {
    return window.localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
};

const markSeen = (news: string): string => {
  try {
    window.localStorage.setItem(SEEN_KEY, news);
  } catch {
    // Without storage the dot shows until the next reload.
  }
  return news;
};
