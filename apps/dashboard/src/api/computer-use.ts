import { type CuaStatus, CuaStatusSchema } from "@aop/common";
import { request } from "./request";

/** Whether CUA Driver can serve threads on the host. Any paired device may ask; `fresh` probes again. */
export const getCuaStatus = async (fresh = false): Promise<CuaStatus> =>
  CuaStatusSchema.parse(await request<unknown>(`/computer-use/cua${fresh ? "?fresh=1" : ""}`));
