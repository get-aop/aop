import { describe, expect, test } from "bun:test";
import { verdict } from "./check-types.ts";
import {
  coordinatorRestricted,
  coordinatorSpawnAndChips,
  systemPromptOnResume,
} from "./checks-coordinator.ts";
import { autoFixOnRealCheck, ghShapes, pullRequestOpened } from "./checks-github.ts";
import { modelAndEffort, rateLimitShapes, usageShapes } from "./checks-runtime.ts";
import {
  askUserAndResume,
  browserAnswerApplied,
  defaultThreadFullAccess,
  editFilesThreadDenied,
} from "./checks-threads.ts";
import { evaluate } from "./evaluate.ts";
import { CODEWORD } from "./prompts.ts";
import {
  emptyObserved,
  initEvent,
  REAL_RATE_LIMIT_EVENT,
  resultEvent,
  run,
  session,
  text,
  threadObservation,
  toolResult,
  toolUse,
} from "./test-utils.ts";

const COORDINATOR_ARGV = ["--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__aop__x"];
const aop = (name: string) => `mcp__aop__${name}`;

describe("coordinator checks", () => {
  const observed = () => {
    const o = emptyObserved();
    o.threads.pr = threadObservation("pr", [run("p1", [])]);
    return o;
  };

  test("restricted: passes when only AOP tools were offered and used", () => {
    const o = observed();
    o.coordinator = {
      ...o.coordinator,
      ...session("coordinator", [
        run("c1", [toolUse("1", aop("thread_spawn")), toolResult("1", "ok")], COORDINATOR_ARGV),
      ]),
    };

    expect(coordinatorRestricted(o).status).toBe("pass");
  });

  test("restricted: fails when a built-in tool ran, or the skip flag was passed", () => {
    const o = observed();
    o.coordinator = {
      ...o.coordinator,
      ...session("coordinator", [
        run(
          "c1",
          [toolUse("1", "Bash", { command: "ls" }), toolResult("1", "a.txt")],
          [...COORDINATOR_ARGV, "--dangerously-skip-permissions"],
        ),
      ]),
    };

    const checked = coordinatorRestricted(o);

    expect(checked.status).toBe("fail");
    expect(checked.summary).toContain("--dangerously-skip-permissions");
    expect(checked.summary).toContain("built-in tool Bash");
  });

  test('restricted: warns when --tools "" left built-ins offered that never ran', () => {
    const o = observed();
    const offered = run("c1", [], COORDINATOR_ARGV);
    offered.events[0] = initEvent({ tools: ["Bash", "mcp__aop__thread_spawn"] });
    o.coordinator = { ...o.coordinator, ...session("coordinator", [offered]) };

    expect(coordinatorRestricted(o).status).toBe("warn");
  });

  test("restricted: skipped when the coordinator never ran", () => {
    expect(coordinatorRestricted(emptyObserved()).status).toBe("skipped");
  });

  test("chips: needs thread_spawn to succeed and the reply to link the started thread", () => {
    const o = observed();
    const threadId = o.threads.pr.session?.id ?? "";
    const events = [
      toolUse("1", aop("thread_spawn"), { title: "T" }),
      toolResult("1", [{ type: "text", text: "{}" }]),
      text(`Started [T](thread:${threadId}).`),
    ];
    o.coordinator = {
      ...o.coordinator,
      ...session("coordinator", [run("c1", events, COORDINATOR_ARGV)]),
    };
    expect(coordinatorSpawnAndChips(o).status).toBe("pass");

    o.coordinator = {
      ...o.coordinator,
      ...session("coordinator", [
        run("c1", [...events.slice(0, 2), text("Started T.")], COORDINATOR_ARGV),
      ]),
    };
    expect(coordinatorSpawnAndChips(o).summary).toContain("thread:");
  });

  test("system prompt on resume: needs --resume, snapshot off, the edited text in argv and the reply", () => {
    const o = observed();
    const argv = [
      "--resume",
      "sess-1",
      "--append-system-prompt",
      `The project codeword is ${CODEWORD}.`,
      "--system-prompt-snapshot",
      "off",
    ];
    o.facts.codewordMessageId = "m-c2";
    o.coordinator = {
      ...o.coordinator,
      ...session("coordinator", [
        run("c1", [], COORDINATOR_ARGV),
        run("c2", [text(`It is ${CODEWORD}.`)], argv),
      ]),
    };
    expect(systemPromptOnResume(o).status).toBe("pass");

    o.coordinator = {
      ...o.coordinator,
      ...session("coordinator", [
        run("c1", [], COORDINATOR_ARGV),
        run("c2", [text("No idea.")], argv),
      ]),
    };
    expect(systemPromptOnResume(o).summary).toContain(`does not contain ${CODEWORD}`);

    o.facts.codewordMessageId = undefined;
    expect(systemPromptOnResume(o).status).toBe("skipped");
  });
});

describe("thread checks", () => {
  const bash = (id: string, command: string, output: string, isError = false) => [
    toolUse(id, "Bash", { command }),
    toolResult(id, output, isError),
  ];

  test("full access: git, bun test and aop_open_pr ran with the skip flag and no denial", () => {
    const o = emptyObserved();
    o.threads.pr = threadObservation("pr", [
      run(
        "p1",
        [
          ...bash("1", "git status; git log --oneline -3", "On branch x"),
          ...bash("2", "bun test", "1 fail", true),
          toolUse("3", aop("aop_open_pr")),
          toolResult("3", [{ type: "text", text: '{"created":true}' }]),
        ],
        ["--dangerously-skip-permissions"],
      ),
    ]);

    expect(defaultThreadFullAccess(o).status).toBe("pass");

    o.threads.pr = threadObservation("pr", [run("p1", bash("1", "ls", "x"), [])]);
    const failed = defaultThreadFullAccess(o);
    expect(failed.status).toBe("fail");
    expect(failed.summary).toContain("--dangerously-skip-permissions was not passed");
    expect(failed.summary).toContain("aop_open_pr did not succeed");
  });

  test("Edit files: code-running commands denied, the edit applied, read-only git allowed", () => {
    const o = emptyObserved();
    const events = [
      ...bash("1", "bun test", "This command requires approval", true),
      ...bash("2", "git status", "On branch x"),
      ...bash("3", "git commit --allow-empty -m probe", "This command requires approval", true),
    ];
    o.threads.edit = {
      ...threadObservation("edit", [run("e1", events, ["--permission-mode", "acceptEdits"])]),
      diff: { files: [{ path: "notes.txt" }] },
    };

    const checked = editFilesThreadDenied(o);

    expect(checked.status).toBe("warn");
    expect(checked.summary).toContain("read-only");

    o.threads.edit = {
      ...o.threads.edit,
      ...session("edit", [run("e1", [...bash("1", "bun test", "1 pass"), ...events.slice(2)], [])]),
    };
    const broken = editFilesThreadDenied(o);
    expect(broken.status).toBe("fail");
    expect(broken.summary).toContain("ran though the thread may only edit files");
  });

  const asking = (answer: string | null) =>
    threadObservation("ask", [
      run("a1", [
        toolUse("1", aop("aop_ask_user"), { question: "Q?", options: [] }),
        toolResult("1", [{ type: "text", text: "delivered" }]),
      ]),
      ...(answer === null ? [] : [run("a2", [text(answer)], ["--resume", "sess-1"])]),
    ]);

  test("ask: both threads ask with the tool, and the answer resumes the same session", () => {
    const o = emptyObserved();
    o.threads.ask = asking("Chosen: formal");
    o.threads.browser = asking(null);

    expect(askUserAndResume(o).status).toBe("pass");

    o.threads.ask = asking("Something else");
    expect(askUserAndResume(o).summary).toContain('is not "Chosen: formal"');

    o.threads.ask = asking(null);
    expect(askUserAndResume(o).summary).toContain("no second run");
  });

  test("ask: a model that calls another tool after asking is a warning, as the real one did", () => {
    const o = emptyObserved();
    const lingering = asking("Chosen: formal");
    lingering.runs[0]?.events.splice(-1, 0, toolUse("9", "ScheduleWakeup", { stop: true }));
    o.threads.ask = lingering;
    o.threads.browser = asking(null);

    const checked = askUserAndResume(o);

    expect(checked.status).toBe("warn");
    expect(checked.summary).toContain("also called ScheduleWakeup after asking");
  });

  test("browser answer: skipped until answered, then judged like any resumed ask", () => {
    const o = emptyObserved();
    o.threads.browser = asking(null);
    expect(browserAnswerApplied(o).status).toBe("skipped");

    o.threads.browser = { ...asking("Saved: fox"), diff: { files: [{ path: "src/mascot.ts" }] } };
    expect(browserAnswerApplied(o).status).toBe("pass");

    o.threads.browser = asking("Saved: fox");
    expect(browserAnswerApplied(o).summary).toContain("src/mascot.ts");
  });
});

describe("runtime checks", () => {
  test("model and effort: every run must pass sonnet and medium", () => {
    const o = emptyObserved();
    o.coordinator = { ...o.coordinator, ...session("coordinator", [run("c1", [])]) };
    expect(modelAndEffort(o).status).toBe("pass");

    const other = run("c2", []);
    other.argv = ["--model", "opus"];
    o.coordinator = { ...o.coordinator, ...session("coordinator", [other]) };
    const checked = modelAndEffort(o);
    expect(checked.status).toBe("fail");
    expect(checked.summary).toContain("--effort medium");
  });

  test("usage: the real result shape and a project total with a Sonnet row pass", () => {
    const o = emptyObserved();
    o.coordinator = { ...o.coordinator, ...session("coordinator", [run("c1", [])]) };
    o.projectUsage = {
      projectId: "p",
      window: { since: null, until: null },
      totals: {
        inputTokens: 4,
        outputTokens: 600,
        cacheWriteTokens: 7000,
        cacheReadTokens: 7000,
        costUsd: 0.04,
        runs: 1,
      },
      byModel: [
        {
          inputTokens: 4,
          outputTokens: 600,
          cacheWriteTokens: 7000,
          cacheReadTokens: 7000,
          costUsd: 0.04,
          runs: 1,
          provider: "claude-code",
          model: "claude-sonnet-5-5",
        },
      ],
      threads: [],
    };

    expect(usageShapes(o).status).toBe("pass");

    o.coordinator.runs[0]?.events.splice(
      -1,
      1,
      resultEvent({ modelUsage: {}, total_cost_usd: "x" }),
    );
    const broken = usageShapes(o);
    expect(broken.status).toBe("fail");
    expect(broken.summary).toContain("modelUsage is missing or empty");
    expect(broken.summary).toContain("total_cost_usd is not a number");
  });

  test("rate limit: records the real allowed_warning shape, and info when none was written", () => {
    const o = emptyObserved();
    expect(rateLimitShapes(o).status).toBe("info");

    const withWarning = run("c1", [REAL_RATE_LIMIT_EVENT]);
    o.coordinator = { ...o.coordinator, ...session("coordinator", [withWarning]) };
    const checked = rateLimitShapes(o);
    expect(checked.status).toBe("pass");
    expect(checked.details.join("\n")).toContain("allowed_warning");

    withWarning.events.push({ type: "rate_limit_event", rate_limit_info: { status: "x" } });
    expect(rateLimitShapes(o).summary).toContain("lacks resetsAt");
  });
});

describe("github checks", () => {
  const gh = (over: Record<string, unknown> = {}) =>
    ({
      head: { ok: true, value: {} },
      view: { ok: true, view: { state: "OPEN" } },
      checks: {
        ok: true,
        value: {
          reported: true,
          checks: [
            {
              name: "ci",
              bucket: "fail",
              state: "FAILURE",
              link: "https://github.com/a/b/actions/runs/1/job/2",
            },
          ],
        },
      },
      rawChecks: "[]",
      reviews: { ok: true, value: [{ id: 1, state: "COMMENTED" }] },
      rawReviews: "[]",
      failedRun: { runId: "1", log: { ok: true, value: 'Expected: "HELLO AOP!"' } },
      ...over,
    }) as never;

  test("gh shapes: pass when every call parsed, and name what did not", () => {
    const o = emptyObserved();
    o.gh = gh();
    expect(ghShapes(o).status).toBe("pass");

    o.gh = gh({
      head: { ok: false, message: "boom" },
      reviews: { ok: true, value: [] },
      failedRun: { runId: null, log: null },
    });
    const broken = ghShapes(o);
    expect(broken.status).toBe("fail");
    expect(broken.summary).toContain("gh pr view (head): boom");
    expect(broken.summary).toContain("review comment was not listed");
    expect(broken.summary).toContain("links to an Actions run");

    expect(ghShapes(emptyObserved()).status).toBe("skipped");
  });

  test("pull request: needs an artifact and the thread's changes", () => {
    const o = emptyObserved();
    o.threads.pr = {
      ...threadObservation("pr", [run("p1", [])]),
      diff: { files: [{ path: "src/greeting.ts" }] },
    };
    o.facts.pullRequestNumber = 1;
    expect(pullRequestOpened(o).status).toBe("pass");

    o.facts.pullRequestNumber = null;
    expect(pullRequestOpened(o).summary).toContain("no pr artifact");
  });

  const fixPrompt = `Automatic fix, attempt 1 of 3: pull request #1 needs work.
Failing checks:
- ci (ci): https://github.com/a/b/actions/runs/1/job/2
> Expected: "HELLO AOP!"`;

  test("auto-fix: the prompt must name the check, link the run, quote a clean log and run a turn", () => {
    const o = emptyObserved();
    o.threads.pr = {
      ...threadObservation("pr", [
        run("p1", []),
        run(
          "p2",
          [toolUse("1", aop("aop_open_pr")), toolResult("1", [{ type: "text", text: "{}" }])],
          [],
          { user_message_id: "msg-fix" },
        ),
      ]),
      messages: [{ id: "msg-fix", role: "user", text: fixPrompt }],
    };
    expect(autoFixOnRealCheck(o).status).toBe("pass");

    o.threads.pr.messages = [
      {
        id: "msg-fix",
        role: "user",
        text: `${fixPrompt}\n> ci\tRun bun test\t2026-09-30T17:30:45.9Z ^[[36;1mbun test`,
      },
    ];
    expect(autoFixOnRealCheck(o).summary).toContain("still carries gh's");

    o.threads.pr.messages = [];
    expect(autoFixOnRealCheck(o).status).toBe("fail");
  });

  test("auto-fix: warns when the turn answered but pushed nothing", () => {
    const o = emptyObserved();
    o.threads.pr = {
      ...threadObservation("pr", [run("p2", [], [], { user_message_id: "msg-fix" })]),
      messages: [{ id: "msg-fix", role: "user", text: fixPrompt }],
    };

    const checked = autoFixOnRealCheck(o);

    expect(checked.status).toBe("warn");
    expect(checked.summary).toContain("did not push a fix");
  });
});

describe("evaluate", () => {
  test("runs every check, and turns a check that throws into a failure", () => {
    const o = emptyObserved();
    // A thread observation without its messages makes the auto-fix check throw.
    (o.threads.pr as { messages: unknown }).messages = undefined;

    const results = evaluate(o);

    expect(results.length).toBeGreaterThanOrEqual(13);
    const crashed = results.find((r) => r.summary.startsWith("the check itself failed"));
    expect(crashed?.status).toBe("fail");
    expect(results.filter((r) => r.status === "skipped").length).toBeGreaterThan(5);
  });

  test("verdict fails with the problems joined, passes with the summary", () => {
    expect(verdict("i", "t", ["a", "b"], "ok").summary).toBe("a; b");
    expect(verdict("i", "t", [], "ok").status).toBe("pass");
  });
});
