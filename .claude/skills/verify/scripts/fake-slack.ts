#!/usr/bin/env bun
/**
 * A fake Slack for verifying the Inbox: the Web API, Socket Mode and the PKCE "Allow" page of
 * `apps/local-server/src/inbox/sources/slack/fake-slack.ts`, one workspace (Acme, you are
 * @marcelo, U0ME), plus a control port to make other people talk.
 *
 *   bun $S/fake-slack.ts serve [--port 25491] [--no-events]   # Slack on <port>, control on <port+1>
 *   bun $S/fake-slack.ts scenario [--port 25491]              # a realistic morning, see below
 *   bun $S/fake-slack.ts say <channel> <user> <text> [--thread <ts>] [--port 25491]
 *   bun $S/fake-slack.ts edit <channel> <ts> <text> | remove <channel> <ts>
 *   bun $S/fake-slack.ts events on|off | refresh | drop | state
 *
 * Point the host at it with `AOP_SLACK_API_URL=http://127.0.0.1:<port>/api/` in the server's
 * environment. Tokens: user `xoxp-fake-user`, app `xapp-fake-app`, Client ID
 * `1111111111.2222222222`; any other is refused as Slack refuses one (invalid_auth).
 * Channels: C0INFRA #infra, C0ANNOUNCE #eng-announce, C0PLATFORM #platform, C0DESIGN #design,
 * C0RANDOM #random, G0OPS #ops (private), D0JONAS (DM with Jonas), G0MPIM (group DM), D0SELF.
 * People: U0PRIYA, U0JONAS, U0ANA, U0MEI, U0SAM. Groups: S0PLATFORM (yours), S0ONCALL.
 */
import {
  type FakeSlack,
  startFakeSlack,
} from "../../../../apps/local-server/src/inbox/sources/slack/fake-slack.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const port = Number(flag("--port") ?? 25491);
const control = `http://127.0.0.1:${port + 1}`;
const [command = "help", ...rest] = args.filter(
  (arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"),
);

const post = async (path: string, body: unknown = {}): Promise<unknown> => {
  const response = await fetch(`${control}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer: unknown = await response.json();
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  return answer;
};

const serve = (): void => {
  const slack = startFakeSlack({ port, events: !args.includes("--no-events") });
  Bun.serve({
    port: port + 1,
    hostname: "127.0.0.1",
    fetch: (request) => controlRoute(slack, request),
  });
  process.stdout.write(`fake Slack on ${slack.apiUrl} (control ${control})\n`);
};

type Body = Record<string, string>;

const CONTROL: Record<string, (slack: FakeSlack, body: Body) => unknown> = {
  "/say": (slack, body) =>
    slack.say({
      channel: body.channel ?? "",
      user: body.user ?? "",
      text: body.text ?? "",
      threadTs: body.thread,
    }),
  "/edit": (slack, body) => slack.edit(body.channel ?? "", body.ts ?? "", body.text ?? ""),
  "/remove": (slack, body) => slack.remove(body.channel ?? "", body.ts ?? ""),
  "/events": (slack, body) => slack.setEvents(body.on === "on"),
  "/refresh": (slack) => slack.refresh(),
  "/drop": (slack) => slack.drop(),
  "/state": () => undefined,
};

const controlRoute = async (slack: FakeSlack, request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname;
  const body = (await request.json().catch(() => ({}))) as Body;
  process.stdout.write(`${new Date().toISOString()} control ${path} ${JSON.stringify(body)}\n`);
  const action = CONTROL[path];
  if (!action) return Response.json({ error: `unknown ${path}` }, { status: 404 });
  const result = action(slack, body);
  if (result !== undefined) return Response.json(result);
  return Response.json({
    sockets: slack.sockets(),
    posted: slack.posted,
    deleted: slack.deleted,
    calls: slack.calls.map((call) => call.method),
  });
};

/**
 * DM, direct mention in a thread, @here, a group, a reply in a thread you started, a message
 * that needs no one, then an edit and a delete.
 */
const scenario = async (): Promise<void> => {
  const say = (channel: string, user: string, text: string, thread?: string) =>
    post("/say", { channel, user, text, thread }) as Promise<{ ts: string }>;
  await say("D0JONAS", "U0JONAS", "are we still on for the release review at 3?");
  const parent = await say(
    "C0INFRA",
    "U0ANA",
    "deploy-check failed again on main. log: https://ci.example.dev/runs/412",
  );
  await say(
    "C0INFRA",
    "U0MEI",
    "looks like the health probe starts before migrations finish",
    parent.ts,
  );
  await say(
    "C0INFRA",
    "U0PRIYA",
    "<@U0ME> can you take the flaky deploy check? Blocking the 0.11 release.",
    parent.ts,
  );
  await say("C0ANNOUNCE", "U0ANA", "<!here> staging DB maintenance tonight 22:00-23:00 UTC");
  await say("C0DESIGN", "U0SAM", "<!subteam^S0PLATFORM|@platform-team> new tokens are in Figma");
  const mine = await say("C0PLATFORM", "U0ME", "retry backoff PR is up");
  await say("C0PLATFORM", "U0MEI", "merged, thanks! one nit on the backoff", mine.ts);
  await say("C0RANDOM", "U0SAM", "lunch?");
  const typo = await say("G0MPIM", "U0ANA", "can someone revew the doc?");
  await post("/edit", { channel: "G0MPIM", ts: typo.ts, text: "can someone review the doc?" });
  const oops = await say("D0JONAS", "U0JONAS", "oops, wrong chat");
  await post("/remove", { channel: "D0JONAS", ts: oops.ts });
};

const commands: Record<string, () => unknown> = {
  serve,
  scenario,
  say: () =>
    post("/say", { channel: rest[0], user: rest[1], text: rest[2], thread: flag("--thread") }),
  edit: () => post("/edit", { channel: rest[0], ts: rest[1], text: rest[2] }),
  remove: () => post("/remove", { channel: rest[0], ts: rest[1] }),
  events: () => post("/events", { on: rest[0] }),
  refresh: () => post("/refresh"),
  drop: () => post("/drop"),
  state: () => post("/state"),
};

const run = commands[command];
if (!run) {
  process.stdout.write(
    "usage: fake-slack.ts serve|scenario|say|edit|remove|events|refresh|drop|state\n",
  );
  process.exit(1);
}
await run();
