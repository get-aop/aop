import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { userMessage } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { UserRow } = await import("./MessageRows");
const { setHostConfig } = await import("../../api/host");

const originalFetch = globalThis.fetch;
const fetchMock = mock(
  async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })),
);

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const image = (name: string) => ({
  id: `img_${name}`,
  mimeType: "image/png" as const,
  path: `/projects/prj_1/images/${name}.png`,
});

describe("a person's message with images", () => {
  test("shows each as a thumbnail above the words, fetched with this device's token", async () => {
    setHostConfig({ baseUrl: "https://host.example", token: "aop_t" });
    render(
      <UserRow
        message={userMessage("u1", 1, { text: "compare", images: [image("a"), image("b")] })}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getAllByTestId("message-image")).toHaveLength(2);
    expect(screen.getByTestId("user-message").textContent).toContain("compare");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://host.example/api/projects/prj_1/images/a.png");
    expect(init?.headers).toEqual({ Authorization: "Bearer aop_t" });
    expect((screen.getAllByRole("img")[0] as HTMLImageElement).src).toStartWith("blob:");
  });

  test("a message of images alone has no bubble", async () => {
    render(<UserRow message={userMessage("u2", 1, { text: "", images: [image("c")] })} />);

    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(screen.getByTestId("user-message").querySelector("[data-slot='bubble']")).toBeNull();
  });

  test("a click opens the image larger", async () => {
    render(<UserRow message={userMessage("u3", 1, { images: [image("d")] })} />);

    fireEvent.click(screen.getByRole("button", { name: "Open image 1" }));

    const viewer = await screen.findByTestId("message-image-viewer");
    await waitFor(() => expect(viewer.querySelector("img")).not.toBeNull());
    expect(viewer.textContent).toContain("Image 1");
  });

  test("an image the host cannot serve says so instead of breaking the row", async () => {
    fetchMock.mockImplementation(async () => new Response("gone", { status: 404 }));
    render(<UserRow message={userMessage("u4", 1, { images: [image("missing")] })} />);

    expect(await screen.findByTestId("message-image-missing")).toBeTruthy();
  });

  test("an image the Library removed keeps its place and says it expired, or was deleted", async () => {
    fetchMock.mockImplementation(async (url) =>
      Response.json(
        {
          error: "This file expired and was removed from the Library",
          code: "IMAGE_REMOVED",
          reason: String(url).includes("old") ? "expired" : "deleted",
        },
        { status: 410 },
      ),
    );
    render(<UserRow message={userMessage("u5", 1, { images: [image("old"), image("gone")] })} />);

    await waitFor(() => expect(screen.getAllByTestId("message-image-removed")).toHaveLength(2));
    const [expired, deleted] = screen.getAllByTestId("message-image-removed");
    expect(expired?.getAttribute("data-reason")).toBe("expired");
    expect(expired?.textContent).toBe("File expired");
    expect(deleted?.textContent).toBe("File deleted");
  });
});
