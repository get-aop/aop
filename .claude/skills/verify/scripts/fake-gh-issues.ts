#!/usr/bin/env bun
/**
 * A fake `gh` for verifying the Issues tab: it answers the reads the issues list makes (who is
 * signed in, the ETag probe of a repository's issues, the GraphQL pages of issues and one
 * issue's body) from issue-fixtures.ts, and hands every other call to fake-gh.ts. Put it first
 * on the server's PATH as `gh` (a two-line wrapper), like fake-gh.ts.
 *
 * Controls, in `$FAKE_GH_DIR` (default `$AOP_HOME/fake-gh`):
 * - a file `signed-out`: `gh` acts logged out (`gh api user` fails with the login hint).
 * - `gh issues-fixture touch`: edits one issue (a new title and update time), so its ETag changes.
 * - `gh issues-fixture sign-out` / `sign-in`: create or remove `signed-out`.
 * Every call is appended to `calls.log` there, so a check can count probes and GraphQL reads.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubIssueNodes } from "./issue-fixtures.ts";

const dir = process.env.FAKE_GH_DIR ?? join(process.env.AOP_HOME ?? tmpdir(), "fake-gh");
mkdirSync(dir, { recursive: true });
const args = process.argv.slice(2);
const versionPath = join(dir, "issues-version");
const signedOutPath = join(dir, "signed-out");
const version = existsSync(versionPath) ? Number(readFileSync(versionPath, "utf8")) || 0 : 0;

const log = (what: string) =>
  appendFileSync(join(dir, "calls.log"), `${new Date().toISOString()} gh-issues ${what}\n`);

const flagValue = (name: string): string | null => {
  for (let index = 0; index < args.length - 1; index++) {
    if ((args[index] === "-f" || args[index] === "-F") && args[index + 1]?.startsWith(`${name}=`)) {
      return args[index + 1]?.slice(name.length + 1) ?? null;
    }
  }
  return null;
};

const out = (text: string, code = 0): never => {
  process.stdout.write(text);
  process.exit(code);
};

const signedOut = () => {
  process.stderr.write("To get started with GitHub CLI, please run:  gh auth login\n");
  process.exit(4);
};

const handlers: [(a: string[]) => boolean, () => void][] = [
  [
    (a) => a[0] === "issues-fixture",
    () => {
      if (args[1] === "touch") writeFileSync(versionPath, String(version + 1));
      if (args[1] === "sign-out") writeFileSync(signedOutPath, "");
      if (args[1] === "sign-in") rmSync(signedOutPath, { force: true });
      out(`${args[1]} done\n`);
    },
  ],
  [
    (a) => a[0] === "api" && a[1] === "user",
    () => {
      log("api user");
      if (existsSync(signedOutPath)) signedOut();
      out("fixture-user\n");
    },
  ],
  [
    (a) =>
      a[0] === "api" &&
      a.includes("-i") &&
      a.some((arg) => /^repos\/[^/]+\/[^/]+\/issues\?/.test(arg)),
    () => {
      if (existsSync(signedOutPath)) signedOut();
      const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
      const nameWithOwner = path.split("/").slice(1, 3).join("/");
      const etag = `W/"${createHash("sha1").update(`${nameWithOwner}:${version}`).digest("hex")}"`;
      const sent = args.find((arg) => arg.startsWith("If-None-Match: "))?.slice(15);
      log(`probe ${nameWithOwner} ${sent === etag ? "304" : "200"}`);
      if (sent === etag) out(`HTTP/2.0 304 Not Modified\r\nEtag: ${etag}\r\n\r\n`, 1);
      out(`HTTP/2.0 200 OK\r\nEtag: ${etag}\r\nContent-Type: application/json\r\n\r\n[]`);
    },
  ],
  [
    (a) => a[0] === "api" && a[1] === "graphql",
    () => {
      if (existsSync(signedOutPath)) signedOut();
      const query = flagValue("query") ?? "";
      const nameWithOwner = `${flagValue("owner")}/${flagValue("name")}`;
      const all = githubIssueNodes(nameWithOwner, version);
      if (query.includes("issue(number")) {
        const issue = all.find((item) => item.number === Number(flagValue("number")));
        log(`graphql issue-body ${nameWithOwner}#${flagValue("number")}`);
        if (!issue) {
          process.stderr.write("GraphQL: Could not resolve to an Issue with the number.\n");
          process.exit(1);
        }
        out(JSON.stringify({ data: { repository: { issue } } }));
      }
      const states = /states: \[([A-Z, ]+)\]/.exec(query)?.[1]?.split(/,\s*/) ?? ["OPEN", "CLOSED"];
      const matching = all.filter((issue) => states.includes(issue.state));
      const first = Number(flagValue("first") ?? 100);
      const start = Number(flagValue("after") ?? 0);
      const page = matching.slice(start, start + first);
      log(`graphql issues ${nameWithOwner} ${states.join("+")} after=${start} -> ${page.length}`);
      out(
        JSON.stringify({
          data: {
            repository: {
              issues: {
                pageInfo: {
                  hasNextPage: start + first < matching.length,
                  endCursor: String(start + page.length),
                },
                nodes: page,
              },
            },
          },
        }),
      );
    },
  ],
];

const handler = handlers.find(([matches]) => matches(args));
if (handler) handler[1]();
else {
  const delegated = spawnSync("bun", [join(import.meta.dir, "fake-gh.ts"), ...args], {
    stdio: "inherit",
  });
  process.exit(delegated.status ?? 1);
}
