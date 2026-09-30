import type {
  AuthPrincipal,
  Device,
  PairDeviceRequest,
  PairedDevice,
  PairingCode,
} from "@aop/common";
import { request } from "./request";

/** Who the host thinks this client is; answers 401 `UNAUTHENTICATED` until the device is paired. */
export const getPrincipal = (): Promise<AuthPrincipal> => request<AuthPrincipal>("/auth/me");

/** Trades the code shown on the host for a device. The response also sets the `aop_device` cookie. */
export const pairDevice = (input: PairDeviceRequest): Promise<PairedDevice> =>
  request<PairedDevice>("/auth/pair", { method: "POST", body: JSON.stringify(input) });

/** Host owner only. A new code replaces the one before it and works once. */
export const createPairingCode = (): Promise<PairingCode> =>
  request<PairingCode>("/auth/pairing-codes", { method: "POST" });

/** Host owner only. */
export const listDevices = async (): Promise<Device[]> =>
  (await request<{ devices: Device[] }>("/auth/devices")).devices;

/** Host owner only. The device's next request answers 401 and its open streams are closed. */
export const revokeDevice = async (deviceId: string): Promise<void> => {
  await request<unknown>(`/auth/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
};
