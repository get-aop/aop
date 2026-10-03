import { InboxNotificationsPageSchema } from "@aop/common";
import type { FetchLike } from "../connection/host-client";
import type { NotificationIntent } from "./policy";

/**
 * The Inbox's desktop notifications. The host decides which new items deserve one (the person's
 * choice in Settings › Connections › Slack, Slack's Do Not Disturb) and queues them; the app
 * reads the queue every few seconds and shows them. The first read only learns where the queue
 * is, so starting the app never replays old ones. A host without an Inbox (older) is asked again
 * only every few minutes.
 */
export interface InboxPollDeps {
  fetch: FetchLike;
  notify: (intent: NotificationIntent) => void;
  isAppFocused: () => boolean;
  schedule: (run: () => void, delayMs: number) => () => void;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export const INBOX_POLL_MS = 10_000;
const MISSING_POLL_MS = 5 * 60_000;

export class InboxPoll {
  private cursor: number | null = null;
  private cancel: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly target: { baseUrl: string; token: string | null },
    private readonly deps: InboxPollDeps,
    private readonly onUnauthorized: () => void,
  ) {}

  start(): void {
    void this.read();
  }

  close(): void {
    this.closed = true;
    this.cancel?.();
  }

  private async read(): Promise<void> {
    const delay = await this.readOnce();
    if (!this.closed && delay !== null) {
      this.cancel = this.deps.schedule(() => void this.read(), delay);
    }
  }

  /** Reads the queue; the wait before the next read, or null to stop. */
  private async readOnce(): Promise<number | null> {
    const after = this.cursor === null ? "" : `?after=${this.cursor}`;
    try {
      const response = await this.deps.fetch(
        `${this.target.baseUrl}/api/inbox/notifications${after}`,
        {
          headers: this.target.token ? { Authorization: `Bearer ${this.target.token}` } : {},
          cache: "no-store",
          credentials: "omit",
        },
      );
      if (response.status === 401) {
        this.onUnauthorized();
        return null;
      }
      if (!response.ok) return MISSING_POLL_MS;
      const page = InboxNotificationsPageSchema.safeParse(await response.json());
      if (!page.success) return MISSING_POLL_MS;
      if (this.cursor !== null && !this.deps.isAppFocused()) {
        for (const notification of page.data.notifications) {
          this.deps.notify({
            kind: "inbox",
            title: notification.title,
            body: notification.body,
            target: { inboxItemId: notification.itemId },
          });
        }
      }
      this.cursor = page.data.cursor;
      return INBOX_POLL_MS;
    } catch (error) {
      this.deps.log?.("could not read the Inbox's notifications", { error: String(error) });
      return INBOX_POLL_MS;
    }
  }
}
