import type { NotificationIntent, NotificationTarget } from "./policy";

/** The part of Electron's `Notification` the notifier uses. */
export interface NotificationLike {
  on(event: "click", listener: () => void): unknown;
  on(event: "close", listener: () => void): unknown;
  on(event: "failed", listener: () => void): unknown;
  show(): void;
}

export interface NotifierDeps {
  isSupported: () => boolean;
  create: (options: { title: string; body: string }) => NotificationLike;
  /** The person clicked a notification: show them what it is about. */
  open: (target: NotificationTarget) => void;
}

export interface Notifier {
  notify: (intent: NotificationIntent) => void;
}

export const createNotifier = (deps: NotifierDeps): Notifier => {
  // Electron drops a notification once nothing references it, which cancels its click handler.
  const shown = new Set<NotificationLike>();

  return {
    notify: (intent) => {
      if (!deps.isSupported()) return;
      const notification = deps.create({ title: intent.title, body: intent.body });
      shown.add(notification);
      const forget = () => void shown.delete(notification);
      notification.on("click", () => {
        forget();
        deps.open(intent.target);
      });
      notification.on("close", forget);
      notification.on("failed", forget);
      notification.show();
    },
  };
};
