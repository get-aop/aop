import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { GithubAvatar } = await import("./GithubAvatar");

afterEach(cleanup);

const ADA = "https://avatars.githubusercontent.com/u/1?u=abc&v=4";

describe("GithubAvatar", () => {
  test("loads GitHub's picture at twice the drawn size, sending no referrer", () => {
    const { container } = render(<GithubAvatar login="ada" avatarUrl={ADA} size={20} />);
    const image = container.querySelector("img");

    expect(image?.getAttribute("src")).toBe(
      "https://avatars.githubusercontent.com/u/1?u=abc&v=4&s=40",
    );
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  test("leaves an address from anywhere else as it is", () => {
    const { container } = render(
      <GithubAvatar login="ada" avatarUrl="https://example.com/ada.png" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/ada.png");
  });

  test("shows the initial when the account has no picture", () => {
    const { container } = render(<GithubAvatar login="ada" avatarUrl={null} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("a");
  });

  test("shows the initial instead of a broken image when the picture does not load", () => {
    const { container } = render(<GithubAvatar login="bob" avatarUrl={ADA} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("b");
  });

  test("gives a new picture its own try after an earlier one failed", () => {
    const { container, rerender } = render(<GithubAvatar login="ada" avatarUrl={ADA} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    rerender(<GithubAvatar login="ada" avatarUrl={`${ADA}2`} />);

    expect(container.querySelector("img")?.getAttribute("src")).toContain(`${ADA}2`);
  });
});
