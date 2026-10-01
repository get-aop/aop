import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { setHostConfig } = await import("./host");
const { loadApiImage, uploadChatImage } = await import("./attachments");

const originalFetch = globalThis.fetch;
const fetchMock = mock(async (_url: string | URL | Request, _init?: RequestInit) =>
  Response.json({ image: { id: "img_1", mimeType: "image/png", size: 4 } }, { status: 201 }),
);

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("uploadChatImage", () => {
  test("posts the file's own bytes with its type, and answers the stored image", async () => {
    setHostConfig({ baseUrl: "https://host.example", token: "aop_t" });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" });

    const image = await uploadChatImage("prj 1", file);

    expect(image).toEqual({ id: "img_1", mimeType: "image/png", size: 4 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://host.example/api/projects/prj%201/attachments");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(file);
    expect(init?.headers).toMatchObject({
      "Content-Type": "image/png",
      Authorization: "Bearer aop_t",
    });
  });

  test("a refusal throws the host's sentence", async () => {
    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        { error: "Images must be 10 MB or smaller", code: "IMAGE_TOO_LARGE" },
        { status: 413 },
      ),
    );

    await expect(uploadChatImage("prj_1", new Blob(["x"]))).rejects.toThrow(
      "Images must be 10 MB or smaller",
    );
  });
});

describe("loadApiImage", () => {
  test("fetches an image once and reuses it; a failure is tried again next time", async () => {
    fetchMock.mockImplementation(
      async () => new Response(new Blob(["png"], { type: "image/png" })),
    );

    const first = await loadApiImage("/projects/p/images/once.png");
    const second = await loadApiImage("/projects/p/images/once.png");

    expect(first).toStartWith("blob:");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementationOnce(async () => new Response("no", { status: 500 }));
    await expect(loadApiImage("/projects/p/images/flaky.png")).rejects.toThrow();
    expect(await loadApiImage("/projects/p/images/flaky.png")).toStartWith("blob:");
  });
});
