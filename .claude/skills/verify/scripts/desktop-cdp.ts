#!/usr/bin/env bun
/**
 * Drives the desktop app's window over the Chrome DevTools Protocol. Claude in Chrome cannot
 * reach an Electron window, so this is the way to look at one: start the app with
 * `--remote-debugging-port=9333`, then
 *
 *   bun .claude/skills/verify/scripts/desktop-cdp.ts targets
 *   bun .claude/skills/verify/scripts/desktop-cdp.ts js '<expression>'      # awaited, returned as JSON
 *   bun .claude/skills/verify/scripts/desktop-cdp.ts jsfile <file.js>
 *   bun .claude/skills/verify/scripts/desktop-cdp.ts shot <file.png>       # a real screenshot of the window
 *   bun .claude/skills/verify/scripts/desktop-cdp.ts errors                # reload, then print console errors
 *
 * `CDP_PORT` overrides the port. It only ever talks to 127.0.0.1.
 */
const port = process.env.CDP_PORT ?? "9333";
const [command = "help", argument = ""] = process.argv.slice(2);

interface Target {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface EventParams {
  exceptionDetails?: { exception?: { description?: string } };
  entry?: { level?: string; text?: string; url?: string };
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[];

if (command === "targets") {
  write(
    JSON.stringify(
      targets.map(({ type, title, url }) => ({ type, title, url })),
      null,
      2,
    ),
  );
  process.exit(0);
}

const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("No page target: is the app running with --remote-debugging-port?");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let lastId = 0;
const waiting = new Map<number, (message: CdpMessage) => void>();
const listeners: ((message: CdpMessage) => void)[] = [];
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data)) as CdpMessage;
  if (message.id !== undefined) waiting.get(message.id)?.(message);
  for (const listener of listeners) listener(message);
};

const send = (method: string, params: object = {}): Promise<CdpMessage> =>
  new Promise((resolve) => {
    lastId += 1;
    waiting.set(lastId, resolve);
    socket.send(JSON.stringify({ id: lastId, method, params }));
  });

const evaluate = async (expression: string): Promise<void> => {
  const reply = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const outcome = reply.result as { result?: { value?: unknown }; exceptionDetails?: unknown };
  write(JSON.stringify(outcome.exceptionDetails ?? outcome.result?.value ?? null, null, 2));
};

const collectErrors = async (): Promise<void> => {
  const seen: string[] = [];
  listeners.push((message) => {
    const params = message.params as EventParams | undefined;
    if (message.method === "Runtime.exceptionThrown") {
      seen.push(
        `EXCEPTION ${String(params?.exceptionDetails?.exception?.description).slice(0, 500)}`,
      );
    } else if (message.method === "Log.entryAdded" && params?.entry?.level !== "info") {
      seen.push(
        `LOG ${params?.entry?.level} ${String(params?.entry?.text).slice(0, 300)} ${params?.entry?.url ?? ""}`,
      );
    }
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.reload");
  await new Promise((resolve) => setTimeout(resolve, 3500));
  write(seen.join("\n") || "no errors");
};

if (command === "js") await evaluate(argument);
else if (command === "jsfile") await evaluate(await Bun.file(argument).text());
else if (command === "shot") {
  const reply = await send("Page.captureScreenshot", { format: "png" });
  await Bun.write(argument, Buffer.from(String(reply.result?.data), "base64"));
  write(`saved ${argument}`);
} else if (command === "errors") await collectErrors();
else write("usage: desktop-cdp.ts <targets|js|jsfile|shot|errors> [argument]");

socket.close();
process.exit(0);
