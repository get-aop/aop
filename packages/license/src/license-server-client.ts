import { type LicenseEntitlement, LicenseEntitlementSchema } from "./types.ts";

export type LicenseServerRequestBody = {
  licenseKey: string;
  machineId: string;
  lemonInstanceId?: string;
};

export type LicenseServerSuccess = {
  ok: true;
  entitlement: LicenseEntitlement;
  lemonInstanceId?: string;
};

export type LicenseServerFailure = { ok: false; error: string };

export type LicenseServerResponse = LicenseServerSuccess | LicenseServerFailure;

export const postLicenseServer = async (
  serverUrl: string,
  path: "/v1/activate" | "/v1/validate",
  body: LicenseServerRequestBody,
): Promise<LicenseServerResponse> => {
  const base = serverUrl.trim().replace(/\/+$/, "");
  if (!base) {
    return { ok: false, error: "License server URL is not configured" };
  }

  const response = await fetch(new URL(path, `${base}/`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      licenseKey: body.licenseKey.trim(),
      machineId: body.machineId.trim(),
      ...(body.lemonInstanceId?.trim() ? { lemonInstanceId: body.lemonInstanceId.trim() } : {}),
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: payload?.error ?? `License server error (${response.status})` };
  }

  const payload = (await response.json()) as {
    entitlement?: LicenseEntitlement;
    lemonInstanceId?: string;
  };
  const parsed = LicenseEntitlementSchema.safeParse(payload.entitlement);
  if (!parsed.success) {
    return { ok: false, error: "License server returned an invalid entitlement" };
  }

  return {
    ok: true,
    entitlement: parsed.data,
    lemonInstanceId: payload.lemonInstanceId?.trim() || undefined,
  };
};
