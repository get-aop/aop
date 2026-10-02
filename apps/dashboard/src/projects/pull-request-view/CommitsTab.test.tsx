import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeDetail } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { CommitsTab } = await import("./CommitsTab");

afterEach(cleanup);

const commitWith = (authors: { login: string; avatarUrl: string | null }[]) =>
  makeDetail({ commits: makeDetail().commits.map((commit) => ({ ...commit, authors })) });

describe("a commit's authors", () => {
  test("shows every author's GitHub picture", () => {
    render(
      <CommitsTab
        detail={commitWith([
          { login: "ada", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
          { login: "claude", avatarUrl: "https://avatars.githubusercontent.com/u/81847?v=4" },
        ])}
      />,
    );
    const sources = [...screen.getByTestId("pr-commit-line").querySelectorAll("img")].map((image) =>
      image.getAttribute("src"),
    );

    expect(sources).toEqual([
      "https://avatars.githubusercontent.com/u/1?v=4&s=36",
      "https://avatars.githubusercontent.com/u/81847?v=4&s=36",
    ]);
  });

  test("an author with no GitHub account, or whose picture fails, shows an initial", () => {
    render(
      <CommitsTab
        detail={commitWith([
          { login: "Grace Hopper", avatarUrl: null },
          { login: "bob", avatarUrl: "https://avatars.githubusercontent.com/u/not-a-user" },
        ])}
      />,
    );
    const line = screen.getByTestId("pr-commit-line");
    fireEvent.error(line.querySelector("img") as HTMLImageElement);

    expect(line.querySelectorAll("img").length).toBe(0);
    expect(line.textContent?.startsWith("GbDraw impacts")).toBe(true);
  });
});
