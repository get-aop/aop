import { describe, expect, test } from "bun:test";
import { serveDashboardPath } from "./dev";

describe("serveDashboardPath", () => {
  test("serves a font the stylesheet points at from its package", async () => {
    // /src/index.css holds url(./files/...), so the browser asks for the fonts under /src/files/.
    for (const path of [
      "/src/files/inter-latin-wght-normal.woff2",
      "/src/files/geist-mono-latin-500-normal.woff2",
    ]) {
      const res = await serveDashboardPath(path);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("font/woff2");
      expect(new TextDecoder().decode((await res.bytes()).slice(0, 4))).toBe("wOF2");
    }
  });

  test("answers a missing file with 404, not the app", async () => {
    for (const path of ["/src/files/nope.woff2", "/files/nope.woff2", "/main-nope.js"]) {
      const res = await serveDashboardPath(path);

      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('<div id="root">');
    }
  });

  test("serves the app for a client route", async () => {
    for (const path of ["/", "/projects/proj_x", "/projects/proj_x/threads/isess_y"]) {
      const res = await serveDashboardPath(path);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/html");
      expect(await res.text()).toContain('<div id="root">');
    }
  });
});
