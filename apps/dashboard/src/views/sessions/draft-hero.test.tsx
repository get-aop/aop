import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { DraftSuggestions, DraftWordmark } = await import("./draft-hero");

afterEach(cleanup);

describe("draft hero", () => {
  test("renders the wordmark and the four suggestion chips", () => {
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
    expect(screen.getByText("Run “Ship it”")).toBeTruthy();
  });

  test("routes each suggestion by id", () => {
    const onSuggestion = mock((_id: string) => {});
    render(<DraftSuggestions onSuggestion={onSuggestion} />);

    fireEvent.click(screen.getByText("Debug failing tests"));
    fireEvent.click(screen.getByText("Run “Ship it”"));
    expect(onSuggestion.mock.calls.map((call) => call[0])).toEqual(["debug", "ship-it"]);
  });
});
