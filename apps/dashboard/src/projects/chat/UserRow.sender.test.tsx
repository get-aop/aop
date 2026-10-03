import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { userMessage } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { UserRow } = await import("./MessageRows");

afterEach(() => {
  cleanup();
});

const inThread = { threadId: "thr_1" } as const;
const LONG_BRIEF = Array.from({ length: 12 }, (_, line) => `Step ${line + 1}: do it.`).join("\n");

const senderLabel = () => screen.getByTestId("sent-message-sender").textContent;
const row = () => screen.getByTestId("user-message");

describe("a message the coordinator sent a thread", () => {
  test("is a card on the left headed Coordinator, not the person's bubble", () => {
    render(
      <UserRow
        message={userMessage("c1", 1, {
          ...inThread,
          sender: "coordinator",
          text: "FYI: the runtime picker is merged.",
        })}
      />,
    );

    expect(senderLabel()).toBe("Coordinator");
    expect(row().getAttribute("data-sender")).toBe("coordinator");
    expect(row().className).toContain("items-start");
    expect(screen.getByTestId("sent-message").textContent).toContain(
      "FYI: the runtime picker is merged.",
    );
    expect(screen.queryByTestId("forwarded-quote")).toBeNull();
    expect(screen.getByTestId("sent-message").hasAttribute("data-brief")).toBe(false);
  });

  test("shows the person's words it forwards as a quote above its own", () => {
    render(
      <UserRow
        message={userMessage("c1", 1, {
          ...inThread,
          sender: "coordinator",
          quote: "release moved to Monday",
          text: "Redate the draft.",
        })}
      />,
    );

    const quote = screen.getByTestId("forwarded-quote");
    expect(quote.textContent).toBe("You said:release moved to Monday");
    expect(screen.getByTestId("forwarded-quote-text").textContent).toBe("release moved to Monday");
    const card = screen.getByTestId("sent-message").textContent ?? "";
    expect(card.indexOf("release moved to Monday")).toBeLessThan(card.indexOf("Redate the draft."));
  });

  test("renders its markdown, as the coordinator wrote it", () => {
    render(
      <UserRow
        message={userMessage("c1", 1, {
          ...inThread,
          sender: "coordinator",
          text: "Two updates:\n\n1. **CUA scope:** browser and computer use.",
        })}
      />,
    );

    const card = screen.getByTestId("sent-message");
    expect(card.querySelector("[data-streamdown=strong]")?.textContent).toBe("CUA scope:");
    expect(card.querySelector("ol") !== null).toBe(true);
  });
});

describe("the brief a thread starts from", () => {
  test("is marked as the coordinator's brief, and a short one opens in full", () => {
    render(
      <UserRow
        message={userMessage("b1", 1, {
          ...inThread,
          sender: "coordinator",
          brief: true,
          text: "Fix the login redirect.",
        })}
      />,
    );

    expect(senderLabel()).toBe("Brief from the coordinator");
    expect(screen.getByTestId("sent-message").getAttribute("data-brief")).toBe("true");
    expect(screen.queryByTestId("user-message-fold")).toBeNull();
  });

  test("opens folded when long, and unfolds on request", () => {
    render(
      <UserRow
        message={userMessage("b1", 1, {
          ...inThread,
          sender: "coordinator",
          brief: true,
          text: LONG_BRIEF,
        })}
      />,
    );

    const card = screen.getByTestId("sent-message");
    const fold = within(card).getByTestId("user-message-fold");
    expect(fold.textContent).toBe("Show full brief");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector('[data-user-message-collapsed="true"]') !== null).toBe(true);

    fireEvent.click(fold);

    expect(fold.textContent).toBe("Show less");
    expect(card.querySelector('[data-user-message-collapsed="false"]') !== null).toBe(true);
  });

  test("a routine's brief names the routine, on the person's side", () => {
    render(
      <UserRow
        message={userMessage("b1", 1, {
          ...inThread,
          sender: "routine",
          brief: true,
          routine: { id: "rtn_1", name: "Weekly deps" },
          text: "Check the deps.",
        })}
      />,
    );

    expect(screen.getByTestId("user-message-routine").textContent).toBe(
      "Brief from routine · Weekly deps",
    );
    expect(screen.queryByTestId("sent-message")).toBeNull();
  });
});

describe("a message AOP sent a thread", () => {
  test("is a card headed AOP", () => {
    render(
      <UserRow
        message={userMessage("s1", 1, {
          ...inThread,
          sender: "system",
          text: "CI failed on the pull request. Fix it.",
        })}
      />,
    );

    expect(senderLabel()).toBe("AOP");
    expect(row().getAttribute("data-sender")).toBe("system");
  });
});

describe("the person's own message", () => {
  test("is their bubble on the right, with no sender card", () => {
    render(
      <UserRow message={userMessage("p1", 1, { ...inThread, sender: "person", text: "hi" })} />,
    );

    expect(row().className).toContain("items-end");
    expect(row().getAttribute("data-sender")).toBe("person");
    expect(screen.queryByTestId("sent-message")).toBeNull();
    expect(screen.getByTestId("user-message-text").textContent).toBe("hi");
  });

  test("a message from a host that names no sender reads as before: the person's bubble, no label", () => {
    render(<UserRow message={userMessage("o1", 1, { ...inThread, text: "older" })} />);

    expect(row().className).toContain("items-end");
    expect(row().hasAttribute("data-sender")).toBe(false);
    expect(screen.queryByTestId("sent-message")).toBeNull();
    expect(screen.queryByTestId("user-message-routine")).toBeNull();
  });
});
