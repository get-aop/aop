import { describe, expect, test } from "bun:test";
import { createNotifier, type NotificationLike } from "./notifier";
import type { NotificationIntent, NotificationTarget } from "./policy";

const intent: NotificationIntent = {
  kind: "needs-you",
  title: "checkout-service",
  body: "Fix the cold start · Which region?",
  target: { projectId: "prj_1", threadId: "thr_1" },
};

const setup = (supported = true) => {
  const created: { title: string; body: string }[] = [];
  const shown: NotificationLike[] = [];
  const listeners = new Map<string, () => void>();
  const opened: NotificationTarget[] = [];
  const notifier = createNotifier({
    isSupported: () => supported,
    create: (options) => {
      created.push(options);
      const notification: NotificationLike = {
        on: (event, listener) => void listeners.set(event, listener),
        show: () => void shown.push(notification),
      };
      return notification;
    },
    open: (target) => void opened.push(target),
  });
  return { notifier, created, shown, listeners, opened };
};

describe("createNotifier", () => {
  test("shows the OS notification with the title and body the policy chose", () => {
    const { notifier, created, shown } = setup();

    notifier.notify(intent);

    expect(created).toEqual([
      { title: "checkout-service", body: "Fix the cold start · Which region?" },
    ]);
    expect(shown).toHaveLength(1);
  });

  test("opens what the notification is about when the person clicks it", () => {
    const { notifier, listeners, opened } = setup();

    notifier.notify(intent);
    listeners.get("click")?.();

    expect(opened).toEqual([{ projectId: "prj_1", threadId: "thr_1" }]);
  });

  test("does nothing where the OS cannot show notifications", () => {
    const { notifier, created } = setup(false);

    notifier.notify(intent);

    expect(created).toEqual([]);
  });
});
