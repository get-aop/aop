import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import type { SessionReviewComment } from "./session-review-queue";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { SessionReviewQueueCards } = await import("./SessionReviewQueueCards");

const comments: SessionReviewComment[] = [
  {
    id: "c1",
    path: "src/a.ts",
    lineType: "add",
    oldNo: null,
    newNo: 4,
    excerpt: "const b = 3;",
    note: "why 3?",
    createdAt: 1,
  },
  {
    id: "c2",
    path: "src/b.ts",
    lineType: "del",
    oldNo: 12,
    newNo: null,
    excerpt: "old code",
    note: "restore this",
    createdAt: 2,
  },
];

afterEach(() => {
  cleanup();
});

describe("SessionReviewQueueCards", () => {
  test("renders nothing for an empty queue", () => {
    render(<SessionReviewQueueCards comments={[]} onUpdate={() => {}} onRemove={() => {}} />);
    expect(screen.queryByTestId("review-queue")).toBeNull();
  });

  test("renders path:line, excerpt, and note for each card", () => {
    render(<SessionReviewQueueCards comments={comments} onUpdate={() => {}} onRemove={() => {}} />);
    const cards = screen.getAllByTestId("review-queue-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("src/a.ts:4");
    expect(cards[0]?.textContent).toContain("const b = 3;");
    expect(cards[0]?.textContent).toContain("why 3?");
    expect(cards[1]?.textContent).toContain("src/b.ts:old line 12");
    expect(cards[1]?.textContent).toContain("restore this");
  });

  test("editing a note saves through onUpdate", () => {
    const updates: Array<[string, string]> = [];
    render(
      <SessionReviewQueueCards
        comments={comments}
        onUpdate={(id, note) => updates.push([id, note])}
        onRemove={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit review comment on src/a.ts"));
    const textarea = screen.getByLabelText("Review comment");
    expect((textarea as HTMLTextAreaElement).value).toBe("why 3?");
    fireEvent.change(textarea, { target: { value: "use 4 instead" } });
    fireEvent.click(screen.getByText("Save"));
    expect(updates).toEqual([["c1", "use 4 instead"]]);
    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();
  });

  test("remove button reports the comment id", () => {
    const removed: string[] = [];
    render(
      <SessionReviewQueueCards
        comments={comments}
        onUpdate={() => {}}
        onRemove={(id) => removed.push(id)}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove review comment on src/b.ts"));
    expect(removed).toEqual(["c2"]);
  });
});
