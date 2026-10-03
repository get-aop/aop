import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExternalLock, STALE_AFTER_MS } from "./external-lock.ts";
import type { CuaLeaseWait } from "./lease.ts";
import { IDLE_MS, RESERVATION_MS } from "./lease.ts";
import { A, B, C, leaseClock, settle } from "./test-utils.ts";

const LONG_WAIT = 60_000;

describe("computer-use lease", () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });
  const lockPath = () => {
    const dir = mkdtempSync(join(tmpdir(), "aop-lease-"));
    dirs.push(dir);
    return join(dir, "aop-cua.lock");
  };

  test("the first thread gets the lease at once; the next ones wait in line, first come first served", async () => {
    const { lease } = leaseClock();
    expect(lease.tryAcquire(A)).toBe(true);
    expect(lease.tryAcquire(B)).toBe(false);

    const order: string[] = [];
    const b = lease.acquire(B, { maxWaitMs: LONG_WAIT }).then((r) => order.push(`B:${r.kind}`));
    const c = lease.acquire(C, { maxWaitMs: LONG_WAIT }).then((r) => order.push(`C:${r.kind}`));
    expect(lease.state().queue.map((w) => [w.threadId, w.position])).toEqual([
      [B.id, 1],
      [C.id, 2],
    ]);
    expect(lease.state().holder).toMatchObject({ kind: "thread", threadId: A.id });

    await lease.release(A.id, "end-session");
    await b;
    expect(lease.holderId()).toBe(B.id);
    expect(lease.state().queue.map((w) => [w.threadId, w.position])).toEqual([[C.id, 1]]);

    await lease.release(B.id, "end-session");
    await c;
    expect(order).toEqual(["B:granted", "C:granted"]);
    expect(lease.holderId()).toBe(C.id);
  });

  test("a thread that holds the lease gets every call through, parallel ones too", async () => {
    const { lease } = leaseClock();
    expect(lease.tryAcquire(A)).toBe(true);
    expect(await lease.acquire(A, { maxWaitMs: LONG_WAIT })).toEqual({ kind: "granted" });
    expect(lease.tryAcquire(A)).toBe(true);
  });

  test("a waiter hears its place and the holder now and whenever they change", async () => {
    const { lease } = leaseClock();
    lease.tryAcquire(A);
    lease.acquire(B, { maxWaitMs: LONG_WAIT });
    const heard: CuaLeaseWait[] = [];
    const c = lease.acquire(C, { maxWaitMs: LONG_WAIT, onWait: (wait) => heard.push(wait) });
    expect(heard.at(-1)?.position).toBe(2);
    expect(heard.at(-1)?.holder).toMatchObject({ kind: "thread", title: A.title });

    await lease.release(A.id, "end-session");
    expect(heard.at(-1)?.position).toBe(1);
    expect(heard.at(-1)?.holder).toMatchObject({ kind: "thread", title: B.title });
    await lease.release(B.id, "end-session");
    await c;
  });

  test("a call that waited too long answers still-waiting, and calling again keeps the place", async () => {
    const { lease } = leaseClock();
    lease.tryAcquire(A);
    lease.acquire(B, { maxWaitMs: LONG_WAIT });
    const first = await lease.acquire(C, { maxWaitMs: 5 });
    expect(first).toMatchObject({ kind: "still-waiting", wait: { position: 2 } });
    expect(lease.waitOf(C.id)?.position).toBe(2);

    // Another thread arriving meanwhile goes behind C.
    lease.acquire({ id: "thr_d", projectId: "prj_1", title: "D" }, { maxWaitMs: LONG_WAIT });
    expect(lease.state().queue.map((w) => w.threadId)).toEqual([B.id, C.id, "thr_d"]);
  });

  test("a place nobody calls back for goes after the reservation", async () => {
    const { lease, clock, tick } = leaseClock();
    lease.tryAcquire(A);
    await lease.acquire(B, { maxWaitMs: 5 });
    clock.advance(RESERVATION_MS + 1);
    await lease.release(A.id, "end-session");
    tick();
    expect(lease.state().queue).toEqual([]);
    expect(lease.holderId()).toBeNull();
  });

  test("a reserved waiter whose turn comes holds the lease, and gives it back if it does not call", async () => {
    const { lease, clock, tick } = leaseClock();
    lease.tryAcquire(A);
    await lease.acquire(B, { maxWaitMs: 5 });
    await lease.release(A.id, "end-session");
    expect(lease.holderId()).toBe(B.id);
    clock.advance(RESERVATION_MS + 1);
    tick();
    await settle();
    expect(lease.holderId()).toBeNull();
  });

  test("an aborted call leaves the line", async () => {
    const { lease } = leaseClock();
    lease.tryAcquire(A);
    const abort = new AbortController();
    const waiting = lease.acquire(B, { maxWaitMs: LONG_WAIT, signal: abort.signal });
    abort.abort();
    expect(await waiting).toEqual({ kind: "aborted" });
    expect(lease.state().queue).toEqual([]);
  });

  test("the turn's end gives the lease back and hands it on, after the cleanup", async () => {
    const { lease } = leaseClock();
    const cleaned: string[] = [];
    lease.setCleanup(async (threadId, reason) => {
      cleaned.push(`${threadId}:${reason}`);
    });
    lease.tryAcquire(A);
    const b = lease.acquire(B, { maxWaitMs: LONG_WAIT });
    await lease.runEnded(A.id);
    expect(await b).toEqual({ kind: "granted" });
    expect(cleaned).toEqual([`${A.id}:run-ended`]);
  });

  test("a waiter whose turn ends leaves the line", async () => {
    const { lease } = leaseClock();
    lease.tryAcquire(A);
    lease.acquire(B, { maxWaitMs: LONG_WAIT });
    lease.acquire(C, { maxWaitMs: LONG_WAIT });
    await lease.runEnded(B.id);
    expect(lease.state().queue.map((w) => [w.threadId, w.position])).toEqual([[C.id, 1]]);
  });

  test("a holder quiet for the idle timeout loses the lease; a running call is never cut", async () => {
    const { lease, clock, tick } = leaseClock();
    const cleaned: string[] = [];
    lease.setCleanup(async (threadId, reason) => {
      cleaned.push(`${threadId}:${reason}`);
    });
    lease.tryAcquire(A);
    lease.callStarted(A.id);
    clock.advance(IDLE_MS + 60_000);
    tick();
    await settle();
    expect(lease.holderId()).toBe(A.id);

    lease.callEnded(A.id);
    clock.advance(IDLE_MS - 1);
    tick();
    expect(lease.holderId()).toBe(A.id);
    clock.advance(2);
    tick();
    await settle();
    expect(lease.holderId()).toBeNull();
    expect(cleaned).toEqual([`${A.id}:idle`]);
  });

  test("a cleanup that hangs never stalls the line", async () => {
    const { lease } = leaseClock({ cleanupTimeoutMs: 5 });
    lease.setCleanup(() => new Promise(() => {}));
    lease.tryAcquire(A);
    const b = lease.acquire(B, { maxWaitMs: LONG_WAIT });
    await lease.release(A.id, "end-session");
    expect(await b).toEqual({ kind: "granted" });
  });

  test("a release by a thread that does not hold the lease changes nothing", async () => {
    const { lease } = leaseClock();
    lease.tryAcquire(A);
    await lease.release(B.id, "end-session");
    expect(lease.holderId()).toBe(A.id);
  });

  describe("the old lock directory", () => {
    test("the host takes it while a thread holds the lease and removes it after", async () => {
      const path = lockPath();
      const { lease } = leaseClock({ externalLock: createExternalLock(path) });
      lease.tryAcquire(A);
      expect(readFileSync(join(path, "owner"), "utf8").trim()).toBe(`AOP host lease: ${A.title}`);
      await lease.release(A.id, "end-session");
      expect(() => readFileSync(join(path, "owner"))).toThrow();
    });

    test("a lock someone else holds keeps the line waiting until it goes", async () => {
      const path = lockPath();
      mkdirSync(path);
      writeFileSync(join(path, "owner"), "Old-style thread\n");
      const { lease, tick } = leaseClock({ externalLock: createExternalLock(path) });
      expect(lease.tryAcquire(A)).toBe(false);
      const a = lease.acquire(A, { maxWaitMs: LONG_WAIT });
      expect(lease.state().holder).toMatchObject({ kind: "external", owner: "Old-style thread" });

      rmSync(path, { recursive: true });
      tick();
      expect(await a).toEqual({ kind: "granted" });
      expect(lease.state().holder).toMatchObject({ kind: "thread", threadId: A.id });
    });

    test("a stale lock is removed and taken", () => {
      const path = lockPath();
      mkdirSync(path);
      writeFileSync(join(path, "heartbeat"), "");
      const old = new Date(Date.now() - STALE_AFTER_MS - 60_000);
      utimesSync(join(path, "heartbeat"), old, old);
      const { lease } = leaseClock({ externalLock: createExternalLock(path) });
      expect(lease.tryAcquire(A)).toBe(true);
      expect(readFileSync(join(path, "owner"), "utf8")).toContain(A.title);
    });

    test("a thread that holds the old lock itself is let through and the lock is left to it", async () => {
      const path = lockPath();
      mkdirSync(path);
      writeFileSync(join(path, "owner"), `${A.title}\n`);
      const { lease } = leaseClock({ externalLock: createExternalLock(path) });
      expect(lease.tryAcquire(A)).toBe(true);
      await lease.release(A.id, "end-session");
      expect(readFileSync(join(path, "owner"), "utf8").trim()).toBe(A.title);
    });
  });
});
