import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { DraftSuggestions, DraftWordmark } = await import("./draft-hero");

afterEach(cleanup);

describe("draft hero", () => {
  test("renders the wordmark and the three suggestion chips", () => {
    render(
      <div>
        <DraftWordmark />
        <DraftSuggestions onSuggestion={() => {}} />
      </div>,
    );

    expect(screen.getByText("aop")).toBeTruthy();
    expect(screen.getByText("Implement a feature")).toBeTruthy();
    expect(screen.getByText("Review a pull request")).toBeTruthy();
    expect(screen.getByText("Debug failing tests")).toBeTruthy();
  });

  test("passes the clicked suggestion as the prompt", () => {
    const onSuggestion = mock((_prompt: string) => {});
    render(<DraftSuggestions onSuggestion={onSuggestion} />);

    fireEvent.click(screen.getByText("Debug failing tests"));
    fireEvent.click(screen.getByText("Review a pull request"));
    expect(onSuggestion.mock.calls.map((call) => call[0])).toEqual([
      "Debug failing tests",
      "Review a pull request",
    ]);
  });
});
