#!/usr/bin/env bun
/**
 * Development server for the dashboard with HMR.
 * Uses Bun.serve() with HTML imports for React/CSS/Tailwind.
 * Proxies /api/* requests to local-server.
 */

import { extname, join } from "node:path";
import { AOP_PORTS, AOP_URLS } from "@aop/common";
import { configureLogging, getLogger } from "@aop/infra";
import { createProxyRequestInit } from "./dev-proxy";
import { findFontFile, fontSourceDirs } from "./font-files";

const log = getLogger("dev");

/**
 * Answers any request but the API: a source file, a font the stylesheet points at, the app for
 * a client route, or a 404 for a missing file. The router owns only paths without an extension;
 * answering a missing font with the app would hide the miss behind a fallback typeface.
 */
export const serveDashboardPath = async (requestPath: string): Promise<Response> => {
  const pathname = resolvePathname(requestPath);
  const file = (await serveStaticFile(pathname)) ?? serveFontFile(pathname);
  if (file) return file;
  if (extname(requestPath) !== "") return new Response("Not Found", { status: 404 });
  return serveSpaFallback();
};

const streamSSEResponse = async (response: Response): Promise<Response> => {
  const { readable, writable } = new TransformStream();

  pipeSSEStream(response, writable);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
};

const pipeSSEStream = (response: Response, writable: WritableStream<Uint8Array>): void => {
  const reader = response.body?.getReader();
  const writer = writable.getWriter();

  if (!reader) {
    writer.close();
    return;
  }

  const pump = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } catch {
      // Connection closed
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  };

  pump();
};

const proxyApiRequest = async (req: Request, url: URL, apiOrigin: string): Promise<Response> => {
  const apiUrl = `${apiOrigin}${url.pathname}${url.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");

  try {
    const response = await fetch(apiUrl, createProxyRequestInit(req, headers));

    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      return streamSSEResponse(response);
    }

    return response;
  } catch (err) {
    log.error("Proxy error: {error}", { error: String(err) });
    return new Response(`Proxy error: ${err}`, { status: 502 });
  }
};

const resolvePathname = (pathname: string): string => {
  if (pathname === "/" || (!pathname.includes(".") && !pathname.startsWith("/src/"))) {
    return "/src/index.html";
  }
  if (pathname.startsWith("/src/")) {
    return pathname;
  }
  const exts = [".css", ".js", ".ts", ".tsx"];
  if (exts.some((ext) => pathname.endsWith(ext))) {
    return `/src${pathname}`;
  }
  return pathname;
};

const serveTypeScript = async (filePath: string): Promise<Response | null> => {
  const result = await Bun.build({
    entrypoints: [filePath],
    target: "browser",
    format: "esm",
    define: { "process.env.NODE_ENV": '"development"' },
  });

  if (result.success && result.outputs[0]) {
    return new Response(await result.outputs[0].text(), {
      headers: { "Content-Type": "application/javascript" },
    });
  }
  return null;
};

const serveTailwindCSS = async (filePath: string): Promise<Response | null> => {
  const result = await Bun.$`bunx tailwindcss -i ${filePath}`.quiet();
  if (result.exitCode === 0) {
    return new Response(new Uint8Array(result.stdout), {
      headers: { "Content-Type": "text/css" },
    });
  }
  return null;
};

const serveStaticFile = async (pathname: string): Promise<Response | null> => {
  const filePath = join(import.meta.dir, pathname);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts")) {
    return serveTypeScript(filePath);
  }

  if (filePath.endsWith(".css")) {
    return serveTailwindCSS(filePath);
  }

  return new Response(file);
};

// The stylesheet is served from /src/, so its `url(./files/...)` fonts are asked for under /src/.
const serveFontFile = (pathname: string): Response | null => {
  if (!pathname.startsWith("/src/")) return null;
  const fontFile = findFontFile(pathname.slice("/src/".length), fontSourceDirs());
  return fontFile ? new Response(Bun.file(fontFile)) : null;
};

const serveSpaFallback = async (): Promise<Response> => {
  const indexFile = Bun.file(join(import.meta.dir, "src/index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, { headers: { "Content-Type": "text/html" } });
  }
  return new Response("Not Found", { status: 404 });
};

const main = async () => {
  await configureLogging({ format: "pretty", serviceName: "dashboard" });
  const port = AOP_PORTS.DASHBOARD;
  const apiOrigin = AOP_URLS.LOCAL_SERVER;

  Bun.serve({
    port,
    // Loopback only. The proxy below reaches the API from 127.0.0.1 with no forwarding
    // headers, so the API takes its requests as the host owner's own; listening on every
    // interface would hand that trust to anyone on the network.
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api/")) {
        return proxyApiRequest(req, url, apiOrigin);
      }

      return serveDashboardPath(url.pathname);
    },
  });

  log.info("Dashboard dev server running at http://localhost:{port}", { port });
  log.info("Proxying /api/* to {apiUrl}", { apiUrl: apiOrigin });
};

if (import.meta.main) {
  main();
}
