import { describe, expect, test } from "bun:test";
import type { ChatSessionMessage } from "../../api/client";
import {
  activityContentWithoutFinal,
  buildTimelineMinimapItems,
  formatRunDuration,
  formatWorkedLabel,
  prepareMessages,
  shouldCollapseUserMessage,
} from "./chat-timeline-model";

const localIso = (daysAgo: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

const message = (input: Partial<ChatSessionMessage> & Pick<ChatSessionMessage, "id" | "role">) => ({
  sessionId: "s1",
  content: input.id,
  action: null,
  createdAt: "2026-07-18T12:00:00.000Z",
  ...input,
});

describe("chat timeline model", () => {
  test("formats T3Code worked durations and interrupted labels", () => {
    expect(formatRunDuration("2026-07-18T12:00:00.000Z", "2026-07-18T12:07:06.000Z")).toBe("7m 6s");
    expect(
      formatWorkedLabel(
        message({
          id: "assistant",
          role: "assistant",
          runStatus: "interrupted",
          createdAt: "2026-07-18T12:00:04.000Z",
        }),
        "2026-07-18T12:00:00.000Z",
      ),
    ).toBe("You stopped after 4s");
  });

  test("keeps queued messages after the live row and tracks the preceding user", () => {
    const messages = [
      message({ id: "u1", role: "user" }),
      message({
        id: "a1",
        role: "assistant",
        createdAt: "2026-07-18T12:00:10.000Z",
        runStatus: "completed",
      }),
      message({ id: "u2", role: "user", disposition: "queued" }),
    ];
    const prepared = prepareMessages(messages, 0, {});
    expect(prepared.visible.map((entry) => entry.message.id)).toEqual(["u1", "a1"]);
    expect(prepared.deferred.map((entry) => entry.message.id)).toEqual(["u2"]);
    expect(prepared.visible[1]?.previousUserCreatedAt).toBe("2026-07-18T12:00:00.000Z");
  });

  test("drops the queued badge once the server claimed the message", () => {
    const messages = [message({ id: "u1", role: "user", disposition: "immediate" })];
    // The optimistic hint outlived the claim (missed assistant-typing, then a reload).
    const prepared = prepareMessages(messages, 0, { u1: "queued" });
    expect(prepared.deferred).toEqual([]);
    expect(prepared.visible[0]?.midRunHint).toBeUndefined();
  });

  test("deduplicates terminal content from folded work", () => {
    const assistant = message({
      id: "a1",
      role: "assistant",
      content: "Final answer",
      activity: { thinking: "", content: "Final answer", commandGroups: [] },
    });
    expect(activityContentWithoutFinal(assistant)).toBe("");
  });

  test("builds message minimap previews and collapses long prompts", () => {
    const prepared = prepareMessages(
      [
        message({ id: "u1", role: "user", content: "First prompt" }),
        message({ id: "a1", role: "assistant", content: "First answer" }),
        message({ id: "u2", role: "user", content: "Second prompt" }),
      ],
      0,
      {},
    );
    expect(buildTimelineMinimapItems(prepared.visible)).toEqual([
      { id: "u1", userText: "First prompt", assistantText: "First answer" },
      { id: "u2", userText: "Second prompt", assistantText: "" },
    ]);
    expect(shouldCollapseUserMessage(Array.from({ length: 9 }, () => "line").join("\n"))).toBe(
      true,
    );
  });

  test("day markers: first message opens a Today separator, same-day rows stay quiet", () => {
    const now = localIso(0);
    const messages = [
      message({ id: "u1", role: "user", createdAt: now }),
      message({ id: "a1", role: "assistant", createdAt: now }),
    ];
    const prepared = prepareMessages(messages, 0, {});
    expect(prepared.visible.map((entry) => entry.dayMarker)).toEqual(["Today", null]);
  });

  test("day markers: first message opens a Today separator, same-day rows stay quiet", () => {
    const now = localIso(0);
    const messages = [
      message({ id: "u1", role: "user", createdAt: now }),
      message({ id: "a1", role: "assistant", createdAt: now }),
    ];
    const prepared = prepareMessages(messages, 0, {});
    expect(prepared.visible.map((entry) => entry.dayMarker)).toEqual(["Today", null]);
  });

  test("day markers: yesterday boundary gets Yesterday, older days get a dated label", () => {
    const messages = [
      message({ id: "u1", role: "user", createdAt: localIso(30) }),
      message({ id: "u2", role: "user", createdAt: localIso(1) }),
      message({ id: "a1", role: "assistant", createdAt: localIso(0) }),
    ];
    const prepared = prepareMessages(messages, 0, {});
    const markers = prepared.visible.map((entry) => entry.dayMarker);
    expect(markers[0]).not.toBeNull();
    expect(["Today", "Yesterday"]).not.toContain(markers[0]);
    expect(markers[1]).toBe("Yesterday");
    expect(markers[2]).toBe("Today");
  });

  test("day markers: slicing preserves the boundary computed over the full thread", () => {
    const messages = [
      message({ id: "u1", role: "user", createdAt: localIso(30) }),
      message({ id: "a1", role: "assistant", createdAt: localIso(30) }),
      message({ id: "u2", role: "user", createdAt: localIso(0) }),
    ];
    const prepared = prepareMessages(messages, 1, {});
    expect(prepared.visible.map((entry) => entry.dayMarker)).toEqual([null, "Today"]);
  });
});
