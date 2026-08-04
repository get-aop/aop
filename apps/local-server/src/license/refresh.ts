import {
  freeEntitlement,
  isSignedLicenseKey,
  isWithinOfflineGrace,
  isWorkerLimitReached,
  type LicenseEntitlement,
  LicenseEntitlementSchema,
  postLicenseServer,
  resolveMaxActiveWorkers,
  shouldRefreshLicenseValidation,
  validateLemonSqueezyLicense,
  verifySignedLicenseKey,
} from "@aop/license";
import type { LicenseStorage } from "./storage.ts";

export type WorkerLimitCheck =
  | { allowed: true; entitlement: LicenseEntitlement }
  | { allowed: false; reason: "limit"; limit: number }
  | { allowed: false; reason: "license_invalid"; message: string };

const parseEntitlement = (raw: string): LicenseEntitlement | null => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = LicenseEntitlementSchema.safeParse(JSON.parse(raw));
    return parsed.success ? normalizeEntitlementLimits(parsed.data) : null;
  } catch {
    return null;
  }
};

const normalizeEntitlementLimits = (entitlement: LicenseEntitlement): LicenseEntitlement => ({
  ...entitlement,
  maxActiveWorkers: resolveMaxActiveWorkers(entitlement.plan),
});

const markValidated = async (storage: LicenseStorage): Promise<void> => {
  await storage.setValidatedAt(new Date().toISOString());
};

type RemoteValidateInput = {
  licenseKey: string;
  machineId: string;
  lemonInstanceId?: string;
  resolveServerUrl: () => Promise<string>;
};

const validatePaidLicenseRemote = async (
  input: RemoteValidateInput,
): Promise<
  | { ok: true; entitlement: LicenseEntitlement; lemonInstanceId?: string }
  | { ok: false; message: string }
> => {
  const apiKey = process.env.LEMON_SQUEEZY_API_KEY?.trim();
  if (apiKey) {
    const result = await validateLemonSqueezyLicense({
      apiKey,
      licenseKey: input.licenseKey,
      machineId: input.machineId,
      lemonInstanceId: input.lemonInstanceId,
    });
    if (!result.success) {
      return { ok: false, message: result.message };
    }
    return {
      ok: true,
      entitlement: result.entitlement,
      lemonInstanceId: result.lemonInstanceId,
    };
  }

  const serverUrl = await input.resolveServerUrl();
  const remote = await postLicenseServer(serverUrl, "/v1/validate", {
    licenseKey: input.licenseKey,
    machineId: input.machineId,
    lemonInstanceId: input.lemonInstanceId,
  });
  if (!remote.ok) {
    return { ok: false, message: remote.error };
  }
  return {
    ok: true,
    entitlement: remote.entitlement,
    lemonInstanceId: remote.lemonInstanceId,
  };
};

const refreshSignedLicense = async (
  storage: LicenseStorage,
  licenseKey: string,
): Promise<{ ok: true; entitlement: LicenseEntitlement } | { ok: false; message: string }> => {
  const entitlement = verifySignedLicenseKey(licenseKey);
  if (!entitlement) {
    return { ok: false, message: "Invalid or expired license key" };
  }
  await storage.setEntitlementJson(JSON.stringify(entitlement));
  await markValidated(storage);
  return { ok: true, entitlement };
};

const applyRemoteValidation = async (
  storage: LicenseStorage,
  remote:
    | { ok: true; entitlement: LicenseEntitlement; lemonInstanceId?: string }
    | { ok: false; message: string },
  cached: LicenseEntitlement | null,
  validatedAt: string | null,
): Promise<{ ok: true; entitlement: LicenseEntitlement } | { ok: false; message: string }> => {
  if (!remote.ok) {
    if (cached && isWithinOfflineGrace(validatedAt)) {
      return { ok: true, entitlement: normalizeEntitlementLimits(cached) };
    }
    return { ok: false, message: remote.message };
  }

  await storage.setEntitlementJson(JSON.stringify(normalizeEntitlementLimits(remote.entitlement)));
  if (remote.lemonInstanceId) {
    await storage.setLemonInstanceId(remote.lemonInstanceId);
  }
  await markValidated(storage);
  return { ok: true, entitlement: remote.entitlement };
};

const refreshRemotePaidEntitlement = async (options: {
  storage: LicenseStorage;
  resolveServerUrl: () => Promise<string>;
  licenseKey: string;
  machineId: string;
  lemonInstanceId?: string;
  cached: LicenseEntitlement | null;
  validatedAt: string | null;
}): Promise<{ ok: true; entitlement: LicenseEntitlement } | { ok: false; message: string }> => {
  if (
    !shouldRefreshLicenseValidation(options.validatedAt) &&
    options.cached?.source === "lemonsqueezy"
  ) {
    return { ok: true, entitlement: normalizeEntitlementLimits(options.cached) };
  }

  try {
    const remote = await validatePaidLicenseRemote({
      licenseKey: options.licenseKey,
      machineId: options.machineId,
      lemonInstanceId: options.lemonInstanceId,
      resolveServerUrl: options.resolveServerUrl,
    });
    return applyRemoteValidation(options.storage, remote, options.cached, options.validatedAt);
  } catch (error) {
    if (options.cached && isWithinOfflineGrace(options.validatedAt)) {
      return { ok: true, entitlement: normalizeEntitlementLimits(options.cached) };
    }
    const message = error instanceof Error ? error.message : "License validation failed";
    return { ok: false, message };
  }
};

export const refreshPaidEntitlement = async (options: {
  storage: LicenseStorage;
  resolveServerUrl: () => Promise<string>;
  resolveMachineId: () => Promise<string>;
}): Promise<{ ok: true; entitlement: LicenseEntitlement } | { ok: false; message: string }> => {
  const licenseKey = (await options.storage.getLicenseKey()).trim();
  if (!licenseKey) {
    return { ok: true, entitlement: freeEntitlement() };
  }

  if (isSignedLicenseKey(licenseKey)) {
    return refreshSignedLicense(options.storage, licenseKey);
  }

  const cached = parseEntitlement(await options.storage.getEntitlementJson());
  const validatedAt = await options.storage.getValidatedAt();
  const machineId = await options.resolveMachineId();
  const lemonInstanceId = (await options.storage.getLemonInstanceId()).trim() || undefined;

  return refreshRemotePaidEntitlement({
    storage: options.storage,
    resolveServerUrl: options.resolveServerUrl,
    licenseKey,
    machineId,
    lemonInstanceId,
    cached,
    validatedAt,
  });
};

export const assertWithinWorkerLimitWithRefresh = async (options: {
  storage: LicenseStorage;
  resolveServerUrl: () => Promise<string>;
  resolveMachineId: () => Promise<string>;
  activeCount: number;
}): Promise<WorkerLimitCheck> => {
  const licenseKey = (await options.storage.getLicenseKey()).trim();
  let entitlement: LicenseEntitlement;

  if (!licenseKey) {
    entitlement = freeEntitlement();
  } else {
    const refreshed = await refreshPaidEntitlement(options);
    if (!refreshed.ok) {
      return { allowed: false, reason: "license_invalid", message: refreshed.message };
    }
    entitlement = refreshed.entitlement;
  }

  const maxWorkers = entitlement.maxActiveWorkers;
  if (isWorkerLimitReached(options.activeCount, maxWorkers)) {
    return { allowed: false, reason: "limit", limit: maxWorkers ?? 0 };
  }

  return { allowed: true, entitlement };
};
