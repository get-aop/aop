import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type AppRoots,
  contentSecurityPolicy,
  createAppProtocolHandler,
  resolveAppRequest,
} from "./app-protocol";

const roots: AppRoots = { shellRoot: "/app/dist", dashboardRoot: "/app/dist/dashboard" };

describe("resolveAppRequest", () => {
  test("maps app://aop to the bundled dashboard and app://desktop to the connect screen", () => {
    expect(resolveAppRequest("app://aop/main-abc.js", roots)).toEqual({
      surface: "dashboard",
      filePath: join("/app/dist/dashboard", "main-abc.js"),
      fallbackPath: null,
    });
    expect(resolveAppRequest("app://desktop/assets/index.js", roots)).toEqual({
      surface: "shell",
      filePath: join("/app/dist", "assets/index.js"),
      fallbackPath: null,
    });
  });

  test("serves index.html for the root of either page", () => {
    expect(resolveAppRequest("app://aop/", roots)?.filePath).toBe(
      join("/app/dist/dashboard", "index.html"),
    );
    expect(resolveAppRequest("app://desktop", roots)?.filePath).toBe(
      join("/app/dist", "index.html"),
    );
  });

  test("lets the dashboard's router own any address that is not a file, and only the dashboard", () => {
    expect(resolveAppRequest("app://aop/projects/prj_1/threads/thr_2", roots)?.fallbackPath).toBe(
      join("/app/dist/dashboard", "index.html"),
    );
    expect(resolveAppRequest("app://aop/missing.js", roots)?.fallbackPath).toBeNull();
    expect(resolveAppRequest("app://desktop/somewhere", roots)?.fallbackPath).toBeNull();
  });

  test("keeps the dashboard's files out of the connect screen's origin", () => {
    // Otherwise the dashboard's code would run with the connect screen's power over the app.
    expect(resolveAppRequest("app://desktop/dashboard/index.html", roots)).toBeNull();
    expect(resolveAppRequest("app://desktop/dashboard", roots)).toBeNull();
    expect(resolveAppRequest("app://desktop/dashboard-notes.txt", roots)).not.toBeNull();
  });

  test("refuses to leave the folder it serves", () => {
    for (const url of [
      "app://aop/../secret.txt",
      "app://aop/%2e%2e/secret.txt",
      "app://aop/..%2f..%2fetc/passwd",
      "app://desktop/%2e%2e%2f%2e%2e%2fetc/passwd",
      "app://aop/%E0%A4%A",
    ]) {
      const resolved = resolveAppRequest(url, roots);
      expect(resolved === null || resolved.filePath.startsWith("/app/dist")).toBe(true);
      expect(resolved?.filePath.includes("..") ?? false).toBe(false);
    }
  });

  test("answers only for the two hosts of the app scheme", () => {
    expect(resolveAppRequest("app://evil/index.html", roots)).toBeNull();
    expect(resolveAppRequest("https://aop/index.html", roots)).toBeNull();
    expect(resolveAppRequest("file:///etc/passwd", roots)).toBeNull();
    expect(resolveAppRequest("not a url", roots)).toBeNull();
  });
});

describe("contentSecurityPolicy", () => {
  test("lets the dashboard talk to its host and load its images, and nothing else", () => {
    const policy = contentSecurityPolicy("dashboard", "https://mac.tail1234.ts.net");

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self' https://mac.tail1234.ts.net");
    expect(policy).toContain("img-src 'self' data: blob: https://mac.tail1234.ts.net");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
  });

  test("gives the dashboard no network at all when no host is chosen", () => {
    expect(contentSecurityPolicy("dashboard", null)).toContain("connect-src 'self';");
  });

  test("gives the connect screen no network, even when a host is chosen", () => {
    const policy = contentSecurityPolicy("shell", "https://mac.tail1234.ts.net");

    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toContain("mac.tail1234.ts.net");
    expect(policy).not.toContain("blob:");
  });
});

describe("createAppProtocolHandler", () => {
  const files = new Map<string, string>([
    [join("/app/dist/dashboard", "index.html"), "<html>dashboard</html>"],
    [join("/app/dist/dashboard", "main-abc.js"), "console.log(1)"],
    [join("/app/dist", "index.html"), "<html>connect</html>"],
  ]);
  const handler = createAppProtocolHandler({
    roots,
    fileExists: (path) => files.has(path),
    serveFile: async (path) =>
      new Response(files.get(path), { headers: { "Content-Type": "text/plain" } }),
    hostOrigin: () => "https://mac.tail1234.ts.net",
  });
  const get = (url: string) => handler(new Request(url));

  test("serves a file with its own content type and the page's security policy", async () => {
    const response = await get("app://aop/main-abc.js");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("console.log(1)");
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self' https://mac.tail1234.ts.net",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("falls back to the dashboard's index for one of its routes", async () => {
    const response = await get("app://aop/projects/prj_1");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>dashboard</html>");
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  test("answers 404 for a missing asset, a foreign host and an escape attempt", async () => {
    for (const url of ["app://aop/missing.js", "app://evil/index.html", "app://aop/%2e%2e/x.txt"]) {
      expect((await get(url)).status).toBe(404);
    }
  });

  test("serves the connect screen without the host in its policy", async () => {
    const response = await get("app://desktop/");

    expect(await response.text()).toBe("<html>connect</html>");
    expect(response.headers.get("content-security-policy")).not.toContain("tail1234");
  });
});
