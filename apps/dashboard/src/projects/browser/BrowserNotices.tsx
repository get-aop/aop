import type { BrowserAsk, BrowserDownload, BrowserPrompt } from "@aop/common";
import { DownloadIcon, GlobeIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { IconButton } from "../../components/IconButton";
import { pageLabel } from "./address";
import type { PageError } from "./BrowserWebview";
import type { RecentPage } from "./tabs";

const ASKS: Record<BrowserAsk, string> = {
  camera: "use your camera",
  microphone: "use your microphone",
  "camera-and-microphone": "use your camera and microphone",
  geolocation: "know your location",
  notifications: "show notifications",
  "open-external": "open a link in another app",
};

/** A page's question, under the toolbar, until the person answers or the page moves on. */
export const PromptBar = ({
  prompt,
  onAnswer,
}: {
  prompt: BrowserPrompt;
  onAnswer: (id: string, allow: boolean) => void;
}) => {
  const external = prompt.ask === "open-external";
  return (
    <div
      role="alertdialog"
      aria-label="Permission request"
      data-testid="browser-prompt"
      data-ask={prompt.ask}
      className="flex shrink-0 items-center gap-3 border-b border-border bg-raised px-3 py-2 text-meta"
    >
      <p className="min-w-0 flex-1 text-text">
        <span className="font-medium">{hostOf(prompt.origin)}</span> wants to {ASKS[prompt.ask]}
        {external && prompt.externalUrl ? (
          <span className="block truncate text-text-subtle">{prompt.externalUrl}</span>
        ) : null}
      </p>
      <Button
        size="sm"
        variant="outline"
        data-testid="browser-prompt-deny"
        onClick={() => onAnswer(prompt.id, false)}
      >
        {external ? "Cancel" : "Block"}
      </Button>
      <Button
        size="sm"
        data-testid="browser-prompt-allow"
        onClick={() => onAnswer(prompt.id, true)}
      >
        {external ? "Open" : "Allow"}
      </Button>
    </div>
  );
};

/** In place of a page that could not load: what went wrong, and a retry. */
export const PageErrorView = ({ error, onRetry }: { error: PageError; onRetry: () => void }) => (
  <div
    data-testid="browser-error"
    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas p-8 text-center"
  >
    <TriangleAlertIcon className="size-6 text-text-subtle" aria-hidden="true" />
    <h2 className="text-title font-semibold text-text">
      {error.code === 0 ? "This page crashed" : "This page can’t be reached"}
    </h2>
    <p className="max-w-md break-all text-meta text-text-muted">{error.url}</p>
    <p className="text-meta text-text-subtle">{error.description}</p>
    <Button size="sm" variant="outline" data-testid="browser-error-retry" onClick={onRetry}>
      Try again
    </Button>
  </div>
);

/** A new tab, or Home: the project's recent pages. */
export const StartPage = ({
  recent,
  onOpen,
}: {
  recent: readonly RecentPage[];
  onOpen: (url: string) => void;
}) => (
  <div
    data-testid="browser-start-page"
    className="absolute inset-0 z-10 overflow-auto bg-canvas px-6 py-8"
  >
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <p className="text-meta text-text-muted">
        Type an address or a search above. To open a link from a chat here, right-click it and
        choose Open in AOP Browser.
      </p>
      {recent.length > 0 ? (
        <section aria-label="Recent pages" className="flex flex-col gap-1">
          <h2 className="text-meta font-medium text-text-subtle">Recent in this project</h2>
          <ul className="flex flex-col">
            {recent.map((page) => (
              <li key={page.url}>
                <button
                  type="button"
                  data-testid="browser-recent"
                  onClick={() => onOpen(page.url)}
                  className="flex w-full min-w-0 items-center gap-2.5 rounded-row px-2 py-1.5 text-left hover:bg-hover"
                >
                  <GlobeIcon className="size-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
                  <span className="truncate text-body text-text">
                    {pageLabel(page.url, page.title)}
                  </span>
                  <span className="ml-auto truncate text-meta text-text-subtle">{page.url}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  </div>
);

/** The toolbar's downloads button, once something was downloaded: each file and what to do with it. */
export const DownloadsButton = ({
  downloads,
  onAction,
}: {
  downloads: readonly BrowserDownload[];
  onAction: (id: string, action: "reveal" | "cancel") => void;
}) => {
  if (downloads.length === 0) return null;
  const busy = downloads.some((download) => download.state === "progressing");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton testId="browser-downloads" label="Downloads" dot={busy}>
          <DownloadIcon />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1.5" data-testid="browser-downloads-list">
        <ul className="flex flex-col">
          {downloads.map((download) => (
            <li
              key={download.id}
              data-testid="browser-download"
              data-state={download.state}
              className="flex items-center gap-2 rounded-row px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-meta text-text">{download.filename}</p>
                <p className="text-meta text-text-subtle">{downloadStatus(download)}</p>
              </div>
              {download.state === "completed" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="browser-download-reveal"
                  onClick={() => onAction(download.id, "reveal")}
                >
                  Show in Finder
                </Button>
              ) : null}
              {download.state === "progressing" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="browser-download-cancel"
                  onClick={() => onAction(download.id, "cancel")}
                >
                  Cancel
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

export const downloadStatus = (download: BrowserDownload): string => {
  switch (download.state) {
    case "completed":
      return `Done · ${formatBytes(download.receivedBytes)}`;
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Failed";
    case "progressing":
      return download.totalBytes > 0
        ? `${Math.floor((download.receivedBytes / download.totalBytes) * 100)}% of ${formatBytes(download.totalBytes)}`
        : formatBytes(download.receivedBytes);
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
};
