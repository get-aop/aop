import type { AuthPrincipal, PairDeviceRequest, PairedDevice } from "@aop/common";
import { request } from "./request";

/** Who the host thinks this client is; answers 401 `UNAUTHENTICATED` until the device is paired. */
export const getPrincipal = (): Promise<AuthPrincipal> => request<AuthPrincipal>("/auth/me");

/** Trades the code shown on the host for a device. The response also sets the `aop_device` cookie. */
export const pairDevice = (input: PairDeviceRequest): Promise<PairedDevice> =>
  request<PairedDevice>("/auth/pair", { method: "POST", body: JSON.stringify(input) });
