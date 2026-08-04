import { describe, expect, test } from "bun:test";
import { createSessionMutationLock, SessionMutationBlockedError } from "./session-mutation-lock.ts";

describe("session mutation lock", () => {
  test("serializes work on the same session and allows different sessions to overlap", async () => {
    const lock = createSessionMutationLock();
    const order: string[] = [];
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();

    const first = lock.withSessions(["csess_a"], async () => {
      order.push("first-start");
      started.resolve();
      await finish.promise;
      order.push("first-end");
    });
    await started.promise;

    const second = lock.withSessions(["csess_a"], async () => {
      order.push("second");
    });
    await lock.withSessions(["csess_b"], async () => {
      order.push("other-session");
    });

    finish.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "other-session", "first-end", "second"]);
  });

  test("acquires multiple locks in id order so callers cannot deadlock", async () => {
    const lock = createSessionMutationLock();
    const results: string[] = [];

    await Promise.all([
      lock.withSessions(["csess_b", "csess_a"], async () => {
        results.push("ba");
      }),
      lock.withSessions(["csess_a", "csess_b"], async () => {
        results.push("ab");
      }),
    ]);

    expect(results).toHaveLength(2);
  });

  test("repo maintenance blocks that repo's mutations and nothing else", async () => {
    const lock = createSessionMutationLock();
    const inside = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const maintenance = lock.withMaintenance(
      { kind: "repo", repoId: "repo_1" },
      async () => ["csess_a"],
      async (handle) => {
        expect(handle.sessionIds).toEqual(["csess_a"]);
        inside.resolve();
        await release.promise;
      },
    );
    await inside.promise;

    for (const kind of ["send", "retry", "steer-claim", "workspace"] as const) {
      expect(() => lock.assertAllowed(kind, { sessionId: "csess_a" })).toThrow(
        SessionMutationBlockedError,
      );
    }
    expect(() => lock.assertAllowed("create", { repoId: "repo_1" })).toThrow(
      SessionMutationBlockedError,
    );
    expect(() => lock.assertAllowed("send", { sessionId: "csess_other" })).not.toThrow();
    expect(() => lock.assertAllowed("create", { repoId: "repo_2" })).not.toThrow();
    expect(lock.isBlocked({ sessionId: "csess_a" })).toBe(true);

    release.resolve();
    await maintenance;
    expect(() => lock.assertAllowed("send", { sessionId: "csess_a" })).not.toThrow();
  });

  test("a factory reset blocks every mutation and session creation", async () => {
    const lock = createSessionMutationLock();
    const inside = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const maintenance = lock.withMaintenance(
      { kind: "global" },
      async () => [],
      async () => {
        inside.resolve();
        await release.promise;
      },
    );
    await inside.promise;

    expect(() => lock.assertAllowed("send", { sessionId: "csess_any" })).toThrow(
      /factory reset is in progress/,
    );
    expect(() => lock.assertAllowed("create", { repoId: null })).toThrow(
      SessionMutationBlockedError,
    );

    release.resolve();
    await maintenance;
    expect(() => lock.assertAllowed("create", { repoId: null })).not.toThrow();
  });

  test("sessions are enumerated only after the barrier is raised", async () => {
    const lock = createSessionMutationLock();
    let blockedDuringEnumeration = false;

    await lock.withMaintenance(
      { kind: "repo", repoId: "repo_1" },
      async () => {
        blockedDuringEnumeration = lock.isBlocked({ repoId: "repo_1" });
        return ["csess_a"];
      },
      async (handle) => {
        expect(handle.sessionIds).toEqual(["csess_a"]);
      },
    );

    expect(blockedDuringEnumeration).toBe(true);
  });

  test("the barrier is lowered even when maintenance throws", async () => {
    const lock = createSessionMutationLock();

    await expect(
      lock.withMaintenance(
        { kind: "repo", repoId: "repo_1" },
        async () => ["csess_a"],
        async () => {
          throw new Error("cleanup failed");
        },
      ),
    ).rejects.toThrow("cleanup failed");

    expect(() => lock.assertAllowed("send", { sessionId: "csess_a" })).not.toThrow();
    await lock.withSessions(["csess_a"], async () => undefined);
  });
});
