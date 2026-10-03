import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createDeviceRepository } from "./device-repository.ts";
import { hashDeviceToken } from "./device-token.ts";
import { type AuthService, createAuthService } from "./service.ts";

const T0 = new Date("2026-09-30T09:00:00.000Z");

describe("auth service", () => {
  let db: Kysely<Database>;
  let clock: Date;
  let auth: AuthService;

  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const pairWith = (code: string, name = "Work Mac") => auth.pairDevice({ code, name });
  const pair = async (name = "Work Mac") => {
    const result = await pairWith(auth.issuePairingCode().code, name);
    if (result.status !== "paired") throw new Error(`Expected pairing, got ${result.status}`);
    return result;
  };
  const storedHashes = async () =>
    (await db.selectFrom("devices").select("token_hash").execute()).map((row) => row.token_hash);

  beforeEach(async () => {
    db = await createTestDb();
    clock = T0;
    auth = createAuthService({
      deviceRepository: createDeviceRepository(db, () => clock),
      now: () => clock,
      host: { version: "0.10.8", channel: "stable" },
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("pairing", () => {
    test("trades the code shown on the host for a device and its token", async () => {
      const { device, token } = await pair("Work Mac");

      expect(device).toMatchObject({ name: "Work Mac", lastSeenAt: null });
      expect(token).toMatch(/^aop_[A-Za-z0-9_-]{43}$/);
      expect(await auth.authenticate(token)).toMatchObject({ id: device.id, name: "Work Mac" });
      expect(await auth.listDevices()).toEqual([expect.objectContaining({ id: device.id })]);
    });

    test("stores only a hash of the token", async () => {
      const { token } = await pair();

      const hashes = await storedHashes();

      expect(hashes).toEqual([hashDeviceToken(token)]);
      expect(hashes[0]).not.toContain(token);
      expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    });

    test("gives every device its own token", async () => {
      const first = await pair("Work Mac");
      const second = await pair("Windows PC");

      expect(first.token).not.toBe(second.token);
      expect((await auth.authenticate(first.token))?.name).toBe("Work Mac");
      expect((await auth.authenticate(second.token))?.name).toBe("Windows PC");
    });

    test("a code pairs one device, once", async () => {
      const { code } = auth.issuePairingCode();

      expect((await pairWith(code)).status).toBe("paired");
      expect((await pairWith(code)).status).toBe("invalid-code");
      expect(await auth.listDevices()).toHaveLength(1);
    });

    test("a wrong or expired code pairs nothing", async () => {
      const { code } = auth.issuePairingCode();

      expect((await pairWith("AAAA-AAAA")).status).toBe("invalid-code");
      advance(10 * 60_000);
      expect((await pairWith(code)).status).toBe("invalid-code");

      expect(await auth.listDevices()).toEqual([]);
    });

    test("stops accepting attempts after five wrong codes in a minute, even the right code", async () => {
      const { code } = auth.issuePairingCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await pairWith("AAAA-AAAA")).status).toBe("invalid-code");
      }

      expect(await pairWith(code)).toEqual({ status: "rate-limited", retryAfterSeconds: 60 });
      expect(await auth.listDevices()).toEqual([]);

      advance(60_000);
      expect((await pairWith(code)).status).toBe("paired");
    });
  });

  describe("authenticate", () => {
    test("matches no device for an unknown token", async () => {
      await pair();

      expect(await auth.authenticate("aop_not-a-real-token")).toBeNull();
      expect(await auth.authenticate("")).toBeNull();
    });

    test("does not accept the stored hash in place of the token", async () => {
      await pair();
      const [hash] = await storedHashes();

      expect(await auth.authenticate(hash ?? "")).toBeNull();
    });

    test("records when the device was last seen, at most once a minute", async () => {
      const { token } = await pair();

      await auth.authenticate(token);
      advance(30_000);
      await auth.authenticate(token);
      const [afterBurst] = await auth.listDevices();
      advance(60_000);
      await auth.authenticate(token);
      const [afterMinute] = await auth.listDevices();

      expect(afterBurst?.lastSeenAt).toBe(T0.toISOString());
      expect(afterMinute?.lastSeenAt).toBe(new Date(T0.getTime() + 90_000).toISOString());
    });
  });

  describe("clients", () => {
    const MAC_APP = { app: "desktop", version: "0.10.7", platform: "darwin" } as const;

    test("records the client a device connects with, and says when its app is older than the host", async () => {
      const { token } = await pair();

      const seen = await auth.authenticate(token, MAC_APP);
      const [listed] = await auth.listDevices();

      expect(seen).toMatchObject({ client: MAC_APP, outOfDate: true });
      expect(listed).toMatchObject({ client: MAC_APP, outOfDate: true });
    });

    test("writes the client only when it changed", async () => {
      const { device, token } = await pair();
      const writes: string[] = [];
      const repository = createDeviceRepository(db, () => clock);
      const counting = createAuthService({
        deviceRepository: {
          ...repository,
          recordClient: async (id, client) => {
            writes.push(`${id} ${client.version}`);
            await repository.recordClient(id, client);
          },
        },
        now: () => clock,
        host: { version: "0.10.8", channel: "stable" },
      });

      await counting.authenticate(token, MAC_APP);
      await counting.authenticate(token, { ...MAC_APP });
      await counting.authenticate(token);
      await counting.authenticate(token, { ...MAC_APP, version: "0.10.8" });

      expect(writes).toEqual([`${device.id} 0.10.7`, `${device.id} 0.10.8`]);
      expect((await counting.listDevices())[0]).toMatchObject({ outOfDate: false });
    });

    test("keeps the client a device paired from", async () => {
      const result = await auth.pairDevice({
        code: auth.issuePairingCode().code,
        name: "Chrome",
        client: { app: "browser", version: null, platform: "linux" },
      });

      expect(result).toMatchObject({
        status: "paired",
        device: { client: { app: "browser", version: null, platform: "linux" }, outOfDate: false },
      });
    });
  });

  describe("revocation", () => {
    test("a revoked device's token stops working and the device leaves the list", async () => {
      const { device, token } = await pair();

      expect(await auth.revokeDevice(device.id)).toBe(true);

      expect(await auth.authenticate(token)).toBeNull();
      expect(await auth.listDevices()).toEqual([]);
    });

    test("revoking one device leaves the others paired", async () => {
      const keep = await pair("Work Mac");
      const drop = await pair("Windows PC");

      await auth.revokeDevice(drop.device.id);

      expect(await auth.authenticate(keep.token)).not.toBeNull();
      expect(await auth.authenticate(drop.token)).toBeNull();
    });

    test("revoking an unknown device changes nothing", async () => {
      await pair();

      expect(await auth.revokeDevice("no-such-device")).toBe(false);
      expect(await auth.listDevices()).toHaveLength(1);
    });

    test("tells whatever holds the device open, once", async () => {
      const { device } = await pair();
      const other = await pair("Windows PC");
      const heard: string[] = [];
      auth.onDeviceRevoked(device.id, () => heard.push("first"));
      auth.onDeviceRevoked(device.id, () => heard.push("second"));
      auth.onDeviceRevoked(other.device.id, () => heard.push("other device"));

      await auth.revokeDevice(device.id);
      await auth.revokeDevice(device.id);

      expect(heard).toEqual(["first", "second"]);
    });

    test("a listener that stopped listening hears nothing", async () => {
      const { device } = await pair();
      const heard: string[] = [];
      const stop = auth.onDeviceRevoked(device.id, () => heard.push("late"));

      stop();
      await auth.revokeDevice(device.id);

      expect(heard).toEqual([]);
    });
  });
});
