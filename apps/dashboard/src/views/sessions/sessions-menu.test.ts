import { describe, expect, test } from "bun:test";
import type { ChatSessionDetail, ChatSessionSummary } from "../../api/client";
import {
  buildMenuItems,
  type MenuItemBuilders,
  menuMinWidth,
  parentMenuFor,
  parentMenuLabel,
} from "./sessions-menu";

const summary = (overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary => ({
  id: "s1",
  scope: "repository",
  repoId: "r1",
  repoName: "aop-mono",
  repoPath: "/tmp/aop",
  workspacePath: "/tmp/aop",
  title: "Target session",
  named: false,
  runtime: "claude-code",
  model: "claude-opus-4-8",
  reasoningEffort: "medium",
  runtimeAlias: null,
  runtimeSessionId: null,
  fastMode: false,
  pinned: true,
  settledOverride: null,
  settledAt: null,
  lastActivityAt: null,
  hasPendingApproval: false,
  assistantActive: false,
  snippet: null,
  unreadCount: 0,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...overrides,
});

const detail = (overrides: Partial<ChatSessionDetail> = {}): ChatSessionDetail => ({
  ...summary({ id: "active", title: "Active session", pinned: false }),
  messages: [],
  assistantActive: false,
  skills: ["commit", "changelog"],
  ...overrides,
});

const builders = (overrides: Partial<MenuItemBuilders> = {}): MenuItemBuilders => ({
  menu: { kind: "closed" },
  active: detail(),
  sessions: [summary(), summary({ id: "active", title: "Active session", pinned: false })],
  skills: ["commit", "changelog"],
  onRename: () => {},
  onPin: () => {},
  onSettle: () => {},
  onUnsettle: () => {},
  onDelete: () => {},
  onRuntime: () => {},
  onModel: () => {},
  onEffort: () => {},
  onControlCommand: () => {},
  onGoal: () => {},

  onSkills: () => {},
  onSkillPick: () => {},
  ...overrides,
});

const sampleRuntimeConfigurations = [
  {
    id: "rtprov_claude_personal",
    name: "Claude Code personal",
    command: "claude-personal",
    driver: "claude-code" as const,
    builtIn: false,
    position: 0,
    supportsFastMode: false,
    models: [
      {
        id: "rtmodel_claude_personal_opus",
        providerId: "rtprov_claude_personal",
        description: "Opus 4.8",
        model: "claude-opus-4-8",
        thinkingLevels: ["low", "medium", "high", "max"] as Array<
          "low" | "medium" | "high" | "extra-high" | "max"
        >,
        builtIn: false,
        position: 0,
        isDefault: true,
        defaultThinkingLevel: null,
      },
    ],
  },
];

describe("submenu parents", () => {
  test("worker and workflow submenus return to Add; runtime settings has no drill-in parents", () => {
    expect(parentMenuFor("cworker")).toBe("cadd");
    expect(parentMenuFor("cworkflow")).toBe("cadd");
    expect(parentMenuFor("cconfig")).toBeNull();
    expect(parentMenuFor("cadd")).toBeNull();
    expect(parentMenuLabel("cadd")).toBe("Add");
  });
});

describe("sessmenuItems", () => {
  test("uses the menu target session for pin/rename — not the active one", () => {
    let renameTitle = "";
    let pinValue = true;
    const items = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        onRename: (_id, title) => {
          renameTitle = title;
        },
        onPin: (_id, pinned) => {
          pinValue = pinned;
        },
      }),
    );

    expect(items.find((i) => i.id === "pin")?.label).toBe("Unpin");
    items.find((i) => i.id === "rename")?.onSelect();
    expect(renameTitle).toBe("Target session");
    items.find((i) => i.id === "pin")?.onSelect();
    expect(pinValue).toBe(false);
  });

  test("exposes reset runtime only when the target has a binding or active run", () => {
    const idle = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        sessions: [summary({ id: "s1", runtimeSessionId: null, assistantActive: false })],
        onResetRuntime: () => {},
      }),
    );
    expect(idle.some((item) => item.id === "reset-runtime")).toBe(false);

    const resetArgs: { id?: string; active?: boolean } = {};
    const bound = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        sessions: [summary({ id: "s1", runtimeSessionId: "bind-1", assistantActive: false })],
        onResetRuntime: (id, active) => {
          resetArgs.id = id;
          resetArgs.active = active;
        },
      }),
    );
    const reset = bound.find((item) => item.id === "reset-runtime");
    expect(reset?.label).toBe("Reset runtime session");
    expect(reset?.separatorBefore).toBe(true);
    reset?.onSelect();
    expect(resetArgs).toEqual({ id: "s1", active: false });

    const activeArgs: { id?: string; active?: boolean } = {};
    const active = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        sessions: [summary({ id: "s1", runtimeSessionId: null, assistantActive: true })],
        onResetRuntime: (id, isActive) => {
          activeArgs.id = id;
          activeArgs.active = isActive;
        },
      }),
    );
    const activeReset = active.find((item) => item.id === "reset-runtime");
    expect(activeReset).toBeDefined();
    activeReset?.onSelect();
    expect(activeArgs).toEqual({ id: "s1", active: true });
  });

  test("shows Settle instead of Archive for active sessions", () => {
    let settled = "";
    const items = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        onSettle: (id) => {
          settled = id;
        },
      }),
    );

    expect(items.map((item) => item.id)).toEqual(["rename", "pin", "settle", "delete"]);
    expect(items.find((item) => item.id === "settle")?.label).toBe("Settle");
    expect(items.some((item) => item.label === "Archive")).toBe(false);
    items.find((item) => item.id === "settle")?.onSelect();
    expect(settled).toBe("s1");
  });

  test("disables Settle while the target session is working", () => {
    const items = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        sessions: [summary({ id: "s1", assistantActive: true, assistantLifecycle: "running" })],
      }),
    );

    expect(items.find((item) => item.id === "settle")?.disabled).toBe(true);
  });

  test("uses the exact settled-session menu order and always includes reset", () => {
    let unsettled = "";
    const items = buildMenuItems(
      builders({
        menu: { kind: "sessmenu", sessionId: "s1" },
        sessions: [
          summary({ id: "s1", settledOverride: "settled", settledAt: new Date().toISOString() }),
        ],
        onUnsettle: (id) => {
          unsettled = id;
        },
        onResetRuntime: undefined,
      }),
    );

    expect(items.map((item) => item.id)).toEqual(["unsettle", "reset-runtime", "rename", "delete"]);
    expect(items.map((item) => item.label)).toEqual([
      "Un-settle thread",
      "Reset runtime session",
      "Rename thread",
      "Delete",
    ]);
    items[0]?.onSelect();
    expect(unsettled).toBe("s1");
  });
});

describe("addItems / skillItems", () => {
  test("hides Skills entry when none discoverable", () => {
    const items = buildMenuItems(builders({ menu: { kind: "cadd" }, skills: [] }));
    expect(items.some((i) => i.id === "skills")).toBe(false);
    expect(items.map((item) => item.id)).toEqual([
      "attach-image",
      "attach-file",
      "worker",
      "workflow",
      "goal",
      "cc-browser-use",
      "cx-browser-use",
      "cc-computer-use",
      "cx-computer-use",
    ]);
  });

  test("structures the Add menu as a flat list with separators between groups", () => {
    const items = buildMenuItems(builders({ menu: { kind: "cadd" }, skills: ["commit"] }));
    expect(items.map((item) => item.id)).toEqual([
      "attach-image",
      "attach-file",
      "worker",
      "workflow",
      "goal",
      "skills",
      "cc-browser-use",
      "cx-browser-use",
      "cc-computer-use",
      "cx-computer-use",
    ]);
    expect(items.find((item) => item.id === "worker")?.separatorBefore).toBe(true);
    expect(items.find((item) => item.id === "cc-browser-use")?.separatorBefore).toBe(true);
    expect(items.find((item) => item.id === "attach-image")?.separatorBefore).toBeUndefined();
    expect(items.find((item) => item.id === "goal")?.separatorBefore).toBeUndefined();
  });

  test("lists discovered skills", () => {
    const picked: string[] = [];
    const items = buildMenuItems(
      builders({
        menu: { kind: "cskills" },
        onSkillPick: (name) => picked.push(name),
      }),
    );
    expect(items.map((i) => i.id)).toEqual(["commit", "changelog"]);
    expect(items.map((i) => i.label)).toEqual(["/commit", "/changelog"]);
    items[0]?.onSelect();
    expect(picked).toEqual(["commit"]);
    expect(items[0]?.mono).toBe(true);
  });

  test("picks worker and workflow deliberately without cycling", () => {
    const selected: string[] = [];
    const workerItems = buildMenuItems(
      builders({
        menu: { kind: "cworker" },
        workers: [
          { id: "w1", name: "Ada" },
          { id: "w2", name: "Bob" },
        ],
        onWorker: (id) => selected.push(`worker:${id}`),
      }),
    );
    const workflowItems = buildMenuItems(
      builders({
        menu: { kind: "cworkflow" },
        workflows: ["quick-fix"],
        onWorkflow: (id) => selected.push(`workflow:${id}`),
      }),
    );

    workerItems[1]?.onSelect();
    workflowItems[0]?.onSelect();
    expect(selected).toEqual(["worker:w2", "workflow:quick-fix"]);
  });

  test("runtime settings do not duplicate CLI control configuration", () => {
    const items = buildMenuItems(builders({ menu: { kind: "cconfig" } }));

    expect(items.some((item) => item.id === "browser-control")).toBe(false);
    expect(items.some((item) => item.id === "computer-control")).toBe(false);
  });

  test("adds each explicit control command from the add menu", () => {
    const selected: string[] = [];
    const items = buildMenuItems(
      builders({
        menu: { kind: "cadd" },
        onControlCommand: (command) => selected.push(command),
      }),
    );

    const controls = items.filter((item) => item.id.endsWith("-use"));
    expect(controls.map((item) => item.label)).toEqual([
      "Claude Browser",
      "Codex Browser",
      "Claude Computer",
      "Codex Computer",
    ]);
    expect(controls.every((item) => item.icon && !item.sub)).toBe(true);
    // Claude vs Codex icons must differ (provider color) even for the same capability.
    expect(controls[0]?.icon).not.toEqual(controls[1]?.icon);
    expect(controls[2]?.icon).not.toEqual(controls[3]?.icon);
    controls.forEach((item) => {
      item.onSelect();
    });
    expect(selected).toEqual([
      "CC_BROWSER_USE",
      "CX_BROWSER_USE",
      "CC_COMPUTER_USE",
      "CX_COMPUTER_USE",
    ]);
  });

  test("runs the CLI GOAL command from the add menu", () => {
    let picked = false;
    const items = buildMenuItems(
      builders({ menu: { kind: "cadd" }, onGoal: () => (picked = true) }),
    );

    items.find((item) => item.id === "goal")?.onSelect();
    expect(picked).toBe(true);
  });

  test("uses distinct icons for Goal and Skills", () => {
    const items = buildMenuItems(builders({ menu: { kind: "cadd" } }));

    expect(items.find((item) => item.id === "goal")?.label).toBe("Goal");
    expect(items.find((item) => item.id === "goal")?.icon).not.toEqual(
      items.find((item) => item.id === "skills")?.icon,
    );
  });
});

describe("configurationItems", () => {
  test("inlines runtime, model, and thinking choices under eyebrow headers", () => {
    const items = buildMenuItems(
      builders({
        menu: { kind: "cconfig" },
        active: detail({
          runtimeConfigurationId: "rtprov_claude_personal",
          model: "claude-opus-4-8",
          reasoningEffort: "medium",
        }),
        runtimeConfigurations: sampleRuntimeConfigurations,
      }),
    );

    expect(items.find((item) => item.id === "header-runtime")).toMatchObject({
      label: "RUNTIME",
      header: true,
      disabled: true,
      dimmed: true,
    });
    expect(items.find((item) => item.id === "header-model")).toMatchObject({
      label: "MODEL",
      header: true,
    });
    expect(items.find((item) => item.id === "header-thinking")).toMatchObject({
      label: "THINKING",
      header: true,
    });

    expect(items.find((item) => item.id === "rtprov_claude_personal")?.check).toBe(true);
    expect(items.find((item) => item.id === "claude-opus-4-8")).toMatchObject({
      label: "Opus 4.8",
      mono: true,
      sub: "claude-opus-4-8",
      check: true,
    });
    expect(items.find((item) => item.id === "medium")?.check).toBe(true);

    // No drill-in rows
    expect(items.some((item) => item.id === "runtime" && !item.header)).toBe(false);
    expect(items.some((item) => item.id === "model" && !item.header)).toBe(false);
    expect(items.some((item) => item.id === "effort")).toBe(false);
  });

  test("includes a Fast mode toggle group when the configuration supports it", () => {
    let toggled: boolean | undefined;
    const items = buildMenuItems(
      builders({
        menu: { kind: "cconfig" },
        active: detail({
          runtime: "pi",
          runtimeConfigurationId: "pi",
          model: "vendor/custom-sol",
          fastMode: true,
        }),
        onFastMode: (value) => {
          toggled = value;
        },
        runtimeConfigurations: [
          {
            id: "pi",
            name: "PI",
            command: "pi",
            driver: "pi",
            builtIn: true,
            position: 0,
            supportsFastMode: true,
            models: [
              {
                id: "rtmodel_pi_custom",
                providerId: "pi",
                description: "Sol (team)",
                model: "vendor/custom-sol",
                thinkingLevels: ["low", "medium", "high"] as Array<
                  "low" | "medium" | "high" | "extra-high" | "max"
                >,
                builtIn: false,
                position: 0,
                isDefault: true,
                defaultThinkingLevel: null,
              },
            ],
          },
        ],
      }),
    );

    expect(items.find((item) => item.id === "header-fast")).toMatchObject({
      label: "FAST",
      header: true,
    });
    const fast = items.find((item) => item.id === "fast");
    expect(fast).toMatchObject({ label: "Fast mode", check: true });
    fast?.onSelect();
    expect(toggled).toBe(false);
  });

  test("includes Fast mode for built-in Claude Opus 5 without enabling other Claude models", () => {
    const runtimeConfigurations = [
      {
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
        driver: "claude-code" as const,
        builtIn: true,
        position: 0,
        supportsFastMode: false,
        models: [],
      },
    ];
    const opus5Items = buildMenuItems(
      builders({
        menu: { kind: "cconfig" },
        active: detail({
          runtime: "claude-code",
          runtimeConfigurationId: "claude-code",
          model: "claude-opus-5",
        }),
        onFastMode: () => undefined,
        runtimeConfigurations,
      }),
    );
    const opus48Items = buildMenuItems(
      builders({
        menu: { kind: "cconfig" },
        active: detail({
          runtime: "claude-code",
          runtimeConfigurationId: "claude-code",
          model: "claude-opus-4-8",
        }),
        onFastMode: () => undefined,
        runtimeConfigurations,
      }),
    );

    expect(opus5Items.some((item) => item.id === "fast")).toBe(true);
    expect(opus48Items.some((item) => item.id === "fast")).toBe(false);
  });

  test("limits thinking options to configured levels for the selected model", () => {
    const items = buildMenuItems(
      builders({
        menu: { kind: "cconfig" },
        active: detail({
          runtime: "pi",
          runtimeConfigurationId: "pi",
          model: "openai-codex/gpt-5.6-sol",
          reasoningEffort: "high",
        }),
        runtimeConfigurations: [
          {
            id: "pi",
            name: "PI",
            command: "pi",
            driver: "pi",
            builtIn: true,
            position: 0,
            supportsFastMode: true,
            models: [
              {
                id: "rtmodel_pi_sol",
                providerId: "pi",
                description: "GPT 5.6 Sol",
                model: "openai-codex/gpt-5.6-sol",
                thinkingLevels: ["low", "medium", "high"] as Array<
                  "low" | "medium" | "high" | "extra-high" | "max"
                >,
                builtIn: false,
                position: 0,
                isDefault: true,
                defaultThinkingLevel: null,
              },
            ],
          },
        ],
      }),
    );

    const afterThinking = items.slice(items.findIndex((item) => item.id === "header-thinking") + 1);
    const effortIds = afterThinking
      .filter((item) => !item.header && item.id !== "header-fast" && item.id !== "fast")
      .map((item) => item.id)
      .filter((id) => ["low", "medium", "high", "extra-high", "max"].includes(id));
    expect(effortIds).toEqual(["low", "medium", "high"]);
  });

  test("uses a wider min width for the inlined configuration panel", () => {
    expect(menuMinWidth("cconfig")).toBe(250);
    expect(menuMinWidth("cadd")).toBe(230);
  });
});
