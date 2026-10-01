import { afterEach, describe, expect, jest, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { MessageMeta } = await import("./MessageMeta");
const { formatTimestampTooltip } = await import("./chat-time");

const NOW = Date.parse("2026-09-30T10:00:00.000Z");
const sentAgo = (ms: number) => new Date(NOW - ms).toISOString();

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MessageMeta", () => {
  test("says how long ago the message was sent, and keeps counting", () => {
    jest.useFakeTimers({ now: NOW });
    render(<MessageMeta timestamp={sentAgo(2 * 60_000)} copyText="hello" />);

    const time = screen.getByTestId("message-time");
    expect(time.textContent).toBe("2m ago");
    expect(time.getAttribute("dateTime")).toBe(sentAgo(2 * 60_000));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("message-time").textContent).toBe("3m ago");
  });

  test("a message from a moment ago reads just now", () => {
    jest.useFakeTimers({ now: NOW });
    render(<MessageMeta timestamp={sentAgo(5_000)} />);

    expect(screen.getByTestId("message-time").textContent).toBe("just now");
  });

  test("every message's time shares one clock", () => {
    jest.useFakeTimers({ now: NOW });
    const before = jest.getTimerCount();
    render(
      <>
        <MessageMeta timestamp={sentAgo(60_000)} />
        <MessageMeta timestamp={sentAgo(120_000)} />
        <MessageMeta timestamp={sentAgo(180_000)} />
      </>,
    );

    expect(jest.getTimerCount() - before).toBe(1);
    cleanup();
    expect(jest.getTimerCount()).toBe(before);
  });

  test("the exact time is in the tooltip", async () => {
    const timestamp = sentAgo(2 * 60_000);
    render(<MessageMeta timestamp={timestamp} />);

    fireEvent.focus(screen.getByTestId("message-time"));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(formatTimestampTooltip(timestamp));
  });
});
