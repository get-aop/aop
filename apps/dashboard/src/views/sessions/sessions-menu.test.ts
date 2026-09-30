import { describe, expect, test } from "bun:test";
import type { ChatSessionDetail, ChatSessionSummary } from "../../api/client";
import { buildMenuItems, type MenuItemBuilders, menuMinWidth } from "./sessions-menu";

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

describe("skillItems", () => {
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

  test("runtime settings do not duplicate CLI control configuration", () => {
    const items = buildMenuItems(builders({ menu: { kind: "cconfig" } }));

    expect(items.some((item) => item.id === "browser-control")).toBe(false);
    expect(items.some((item) => item.id === "computer-control")).toBe(false);
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
          runtime: "claude-code",
          runtimeConfigurationId: "claude-work",
          model: "claude-opus-5",
          fastMode: true,
        }),
        onFastMode: (value) => {
          toggled = value;
        },
        runtimeConfigurations: [
          {
            id: "claude-work",
            name: "Claude Work",
            command: "claude-work",
            driver: "claude-code",
            builtIn: false,
            position: 0,
            supportsFastMode: true,
            models: [
              {
                id: "rtmodel_work_opus",
                providerId: "claude-work",
                description: "Opus 5 (team)",
                model: "claude-opus-5",
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
          runtime: "claude-code",
          runtimeConfigurationId: "claude-work",
          model: "claude-opus-4-8",
          reasoningEffort: "high",
        }),
        runtimeConfigurations: [
          {
            id: "claude-work",
            name: "Claude Work",
            command: "claude-work",
            driver: "claude-code",
            builtIn: false,
            position: 0,
            supportsFastMode: false,
            models: [
              {
                id: "rtmodel_work_opus",
                providerId: "claude-work",
                description: "Opus 4.8",
                model: "claude-opus-4-8",
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
    expect(menuMinWidth("cskills")).toBe(220);
    expect(menuMinWidth("sessmenu")).toBe(190);
  });
});
