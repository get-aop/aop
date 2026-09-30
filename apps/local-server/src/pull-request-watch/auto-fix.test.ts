import { describe, expect, test } from "bun:test";
import { reloadThread } from "../thread/pr-test-utils.ts";
import {
  fixPrompts,
  ledgerOf,
  MINUTE,
  openedThread,
  reportsToCoordinator,
  useWatchWorld,
} from "./test-utils.ts";
import { createPullRequestWatcher } from "./watcher.ts";

const world = useWatchWorld();

describe("a pull request whose checks fail", () => {
  test("sends the thread one fix prompt naming the failing checks, and never sends it twice", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "pending", ["test", "lint"]);
    await w.tick();
    // The round is still running: the watcher waits for all of it.
    expect(await fixPrompts(w, thread.id)).toEqual([]);

    w.github.ci.setChecks(number, "fail", ["test", "lint"]);
    await w.tick(MINUTE);
    const prompts = await fixPrompts(w, thread.id);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("attempt 1 of 3");
    expect(prompts[0]).toContain("pull request #1");
    expect(prompts[0]).toContain(
      "- test (ci): https://github.com/acme/widget/actions/runs/100/job/1000",
    );
    expect(prompts[0]).toContain(
      "- lint (ci): https://github.com/acme/widget/actions/runs/100/job/1001",
    );
    // The prompt went the way a person's message goes: the thread ran a turn for it, in its worktree.
    const after = await reloadThread(w.s, thread.id);
    expect(after.repliesCount).toBe(2);
    expect(after.status).toBe("ready-for-review");

    // The same failing run seen again, on every poll, is not asked about again.
    await w.tick(MINUTE);
    await w.tick(MINUTE);
    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
    expect(await ledgerOf(w, thread.id)).toMatchObject([
      { kind: "fix", delivered: true, summary: "failing checks: test, lint" },
    ]);
  });

  test("quotes the end of the failing run's log in the prompt, and sends without one when the run printed nothing", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(
      number,
      "fail",
      ["test"],
      "\u001b[31mFAIL\u001b[0m cold-start.test.ts\nexpected 2, got 3",
    );
    await w.tick();

    const [prompt] = await fixPrompts(w, thread.id);

    expect(prompt).toContain(
      "The end of the log of run 100, quoted from GitHub:\n> FAIL cold-start.test.ts\n> expected 2, got 3",
    );
    expect(w.github.callsTo("run view")).toEqual([["run", "view", "100", "--log-failed"]]);

    // A run with nothing in its log leaves the prompt without one (an unreadable log does the same: see logs.test.ts).
    w.github.ci.push(number);
    w.github.ci.setChecks(number, "fail", ["test"], "");
    await w.tick(MINUTE);
    const second = (await fixPrompts(w, thread.id))[1];
    expect(second).toContain("attempt 2 of 3");
    expect(second).not.toContain("The end of the log");
  });

  test("a restart in the middle of the failing window sends nothing again", async () => {
    const w = await world.setup();
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");
    await w.tick();
    expect(await fixPrompts(w, thread.id)).toHaveLength(1);

    // A new watcher over the same database is what a restarted server has: no memory but the stored one.
    const restarted = createPullRequestWatcher(
      w.s.ctx,
      { threads: w.s.services.threads, git: w.s.services.git, chat: w.s.services.chat },
      { runGh: w.github.run, now: () => new Date(w.clock.now), random: () => 0.5 },
    );
    w.clock.now += MINUTE;
    await restarted.tick();
    await w.s.settle();

    expect(await fixPrompts(w, thread.id)).toHaveLength(1);
  });

  test("answers a new failure after the thread pushed, and stops at the cap with a report to the coordinator", async () => {
    const w = await world.setup({ watch: { maxAttempts: 2 } });
    const { thread, number } = await openedThread(w);
    w.github.ci.setChecks(number, "fail");
    await w.tick();
    // The thread pushes its fix; CI runs again and fails again, as another run.
    w.github.ci.push(number);
    w.github.ci.setChecks(number, "fail");
    await w.tick(MINUTE);
    const prompts = await fixPrompts(w, thread.id);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("attempt 2 of 2");
    expect(prompts[1]).toContain("/actions/runs/101/");
    // Each fix turn is reported like any turn; nothing has asked for the person yet.
    const before = await reportsToCoordinator(w, w.project.id);
    expect(before).toHaveLength(3);
    expect(before.some((report) => report.startsWith("needs-you"))).toBe(false);

    // A third failed round is over the cap: the watcher stops, says so once, and sends nothing more.
    w.github.ci.push(number);
    w.github.ci.setChecks(number, "fail");
    await w.tick(MINUTE);
    await w.tick(MINUTE);

    expect(await fixPrompts(w, thread.id)).toHaveLength(2);
    const reports = await reportsToCoordinator(w, w.project.id);
    expect(reports.filter((report) => report.startsWith("needs-you"))).toEqual([
      expect.stringContaining("stopped fixing pull request #1 by itself"),
    ]);
    const stopped = await reloadThread(w.s, thread.id);
    expect(stopped.unread).toBe(true);
    expect(stopped.liveStatusLine).toBe("Auto-fix stopped after 2 attempts: failing checks: test");
    expect((await ledgerOf(w, thread.id)).map((entry) => entry.kind)).toEqual([
      "fix",
      "fix",
      "cap",
    ]);
  });
});
