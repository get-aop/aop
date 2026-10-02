import { describe, expect, test } from "bun:test";
import { faviconDataUrl } from "./favicon";

const image = (bytes: number, type = "image/png", status = 200) =>
  new Response(new Uint8Array(bytes).fill(1), { status, headers: { "content-type": type } });

describe("a page's icon", () => {
  test("is fetched and handed over as a data URL", async () => {
    const icon = await faviconDataUrl(["https://example.com/favicon.png"], async () => image(3));
    expect(icon).toBe("data:image/png;base64,AQEB");
  });

  test("a data URL the page gave is used as it is", async () => {
    const url = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(await faviconDataUrl([url], async () => image(1))).toBe(url);
  });

  test("tries the next candidate when one is not a small image", async () => {
    const responses: Record<string, Response> = {
      "https://a.example/missing.ico": image(1, "image/x-icon", 404),
      "https://a.example/page.html": image(10, "text/html"),
      "https://a.example/huge.png": image(200 * 1024),
      "https://a.example/ok.ico": image(2, "image/x-icon; charset=binary"),
    };
    const icon = await faviconDataUrl(
      ["file:///etc/icon.png", ...Object.keys(responses)],
      async (url) => responses[url] as Response,
    );
    expect(icon).toBe("data:image/x-icon;base64,AQE=");
  });

  test("is null when nothing works, a failed fetch included", async () => {
    const icon = await faviconDataUrl(["https://a.example/x.png"], async () => {
      throw new Error("offline");
    });
    expect(icon).toBeNull();
  });
});
