import { randomUUID } from "node:crypto";
import type { Device } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { DeviceRepository } from "./device-repository.ts";
import { generateDeviceToken, hashDeviceToken } from "./device-token.ts";
import { createFailureLimiter, type FailureLimiter } from "./failure-limiter.ts";
import { createPairingCodes, type PairingCodeGrant, type PairingCodes } from "./pairing-codes.ts";

const logger = getLogger("auth");

// Pairing is rare and typed by hand. Five wrong codes a minute is generous for a person and
// out of reach for a guesser: the code space is 32^8, and a code lives ten minutes.
const PAIRING_MAX_FAILURES = 5;
const PAIRING_FAILURE_WINDOW_MS = 60_000;
// `lastSeenAt` is for the owner to tell devices apart, so a minute of precision is plenty
// and keeps a busy client from writing to the database on every request.
const LAST_SEEN_INTERVAL_MS = 60_000;

export type PairDeviceResult =
  | { status: "paired"; device: Device; token: string }
  | { status: "invalid-code" }
  | { status: "rate-limited"; retryAfterSeconds: number };

export interface AuthService {
  issuePairingCode: () => PairingCodeGrant;
  /** Trades a live one-time code for a new device and its bearer token, shown only here. */
  pairDevice: (input: { code: string; name: string }) => Promise<PairDeviceResult>;
  /** The device a bearer token belongs to, or null when it matches none (or was revoked). */
  authenticate: (token: string) => Promise<Device | null>;
  listDevices: () => Promise<Device[]>;
  /** Deletes the device so its token stops matching, and tells anything holding it open. */
  revokeDevice: (id: string) => Promise<boolean>;
  /** Runs once when the device is revoked. Returns a function that stops listening. */
  onDeviceRevoked: (deviceId: string, listener: () => void) => () => void;
}

export interface AuthServiceOptions {
  deviceRepository: DeviceRepository;
  pairingCodes?: PairingCodes;
  pairingLimiter?: FailureLimiter;
  now?: () => Date;
}

export const createAuthService = (options: AuthServiceOptions): AuthService => {
  const { deviceRepository: devices } = options;
  const now = options.now ?? (() => new Date());
  const pairingCodes = options.pairingCodes ?? createPairingCodes({ now });
  const pairingLimiter =
    options.pairingLimiter ??
    createFailureLimiter({
      maxFailures: PAIRING_MAX_FAILURES,
      windowMs: PAIRING_FAILURE_WINDOW_MS,
      now,
    });
  const revocationListeners = new Map<string, Set<() => void>>();

  return {
    issuePairingCode: () => pairingCodes.issue(),

    pairDevice: async ({ code, name }) => {
      const retryAfterMs = pairingLimiter.retryAfterMs();
      if (retryAfterMs > 0) {
        logger.warn("Pairing refused: too many wrong codes");
        return { status: "rate-limited", retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
      }
      if (!pairingCodes.consume(code)) {
        pairingLimiter.recordFailure();
        logger.warn("Pairing refused: wrong or expired code");
        return { status: "invalid-code" };
      }

      const token = generateDeviceToken();
      const device = await devices.create({
        id: randomUUID(),
        name,
        tokenHash: hashDeviceToken(token),
      });
      logger.info("Paired device {deviceId} ({name})", { deviceId: device.id, name: device.name });
      return { status: "paired", device, token };
    },

    authenticate: async (token) => {
      const device = await devices.findByTokenHash(hashDeviceToken(token));
      if (!device) return null;
      if (isStale(device, now())) await devices.touchLastSeen(device.id);
      return device;
    },

    listDevices: () => devices.list(),

    revokeDevice: async (id) => {
      const removed = await devices.remove(id);
      if (!removed) return false;
      logger.info("Revoked device {deviceId}", { deviceId: id });
      const listeners = revocationListeners.get(id);
      revocationListeners.delete(id);
      for (const listener of listeners ?? []) listener();
      return true;
    },

    onDeviceRevoked: (deviceId, listener) => {
      const listeners = revocationListeners.get(deviceId) ?? new Set();
      listeners.add(listener);
      revocationListeners.set(deviceId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && revocationListeners.get(deviceId) === listeners) {
          revocationListeners.delete(deviceId);
        }
      };
    },
  };
};

const isStale = (device: Device, at: Date): boolean =>
  device.lastSeenAt === null ||
  at.getTime() - Date.parse(device.lastSeenAt) >= LAST_SEEN_INTERVAL_MS;
