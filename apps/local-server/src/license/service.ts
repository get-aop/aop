import {
  activateLemonSqueezyLicense,
  freeEntitlement,
  getMachineId,
  isSignedLicenseKey,
  type LicenseEntitlement,
  LicenseEntitlementSchema,
  type LicenseStatus,
  postLicenseServer,
  resolveMaxActiveWorkers,
  verifySignedLicenseKey,
} from "@aop/license";
import type { AgentRepository } from "../agent/repository.ts";
import { assertWithinWorkerLimitWithRefresh } from "./refresh.ts";
import type { LicenseStorage } from "./storage.ts";
import { DEFAULT_LICENSE_SERVER_URL } from "./storage.ts";

export type ActivateLicenseResult =
  | { success: true; status: LicenseStatus }
  | { success: false; message: string };

export interface LicenseService {
  getEntitlement: () => Promise<LicenseEntitlement>;
  getMaxActiveWorkers: () => Promise<number | null>;
  getStatus: (activeWorkerCount: number) => Promise<LicenseStatus>;
  activate: (licenseKey: string) => Promise<ActivateLicenseResult>;
  clear: () => Promise<LicenseStatus>;
}

const parseStoredEntitlement = (raw: string): LicenseEntitlement | null => {
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = LicenseEntitlementSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const maskLicenseKey = (licenseKey: string): string | null => {
  const trimmed = licenseKey.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length <= 4 ? trimmed : `••••${trimmed.slice(-4)}`;
};

export const createLicenseService = (
  storage: LicenseStorage,
  agentRepository: AgentRepository,
): LicenseService => {
  const resolveMachineId = async (): Promise<string> => {
    const stored = (await storage.getMachineId()).trim();
    if (stored) {
      return stored;
    }

    const machineId = getMachineId();
    await storage.setMachineId(machineId);
    return machineId;
  };

  const resolveServerUrl = async (): Promise<string> => {
    const configured = (await storage.getServerUrl()).trim();
    return configured || process.env.AOP_LICENSE_SERVER_URL?.trim() || DEFAULT_LICENSE_SERVER_URL;
  };

  const persistActivation = async (
    licenseKey: string,
    entitlement: LicenseEntitlement,
    lemonInstanceId?: string,
  ): Promise<LicenseEntitlement> => {
    await storage.setLicenseKey(licenseKey.trim());
    await storage.setEntitlementJson(JSON.stringify(entitlement));
    await storage.setValidatedAt(new Date().toISOString());
    if (lemonInstanceId?.trim()) {
      await storage.setLemonInstanceId(lemonInstanceId.trim());
    }
    return entitlement;
  };

  const activateRemote = async (
    licenseKey: string,
    machineId: string,
  ): Promise<ActivateLicenseResult> => {
    const serverUrl = await resolveServerUrl();
    const remote = await postLicenseServer(serverUrl, "/v1/activate", { licenseKey, machineId });
    if (!remote.ok) {
      return { success: false, message: remote.error };
    }

    await persistActivation(licenseKey, remote.entitlement, remote.lemonInstanceId);
    const activeWorkers = await agentRepository.countActive();
    return {
      success: true,
      status: await buildStatus(remote.entitlement, activeWorkers, licenseKey),
    };
  };

  const activateLocalLemonSqueezy = async (
    licenseKey: string,
    machineId: string,
  ): Promise<ActivateLicenseResult> => {
    const apiKey = process.env.LEMON_SQUEEZY_API_KEY?.trim();
    if (!apiKey) {
      return activateRemote(licenseKey, machineId);
    }

    const result = await activateLemonSqueezyLicense({ apiKey, licenseKey, machineId });
    if (!result.success) {
      return { success: false, message: result.message };
    }

    await persistActivation(licenseKey, result.entitlement, result.lemonInstanceId);
    const activeWorkers = await agentRepository.countActive();
    return {
      success: true,
      status: await buildStatus(result.entitlement, activeWorkers, licenseKey),
    };
  };

  const buildStatus = async (
    entitlement: LicenseEntitlement,
    activeWorkers: number,
    licenseKey?: string,
  ): Promise<LicenseStatus> => {
    const storedKey = licenseKey ?? (await storage.getLicenseKey());
    const validatedAt = (await storage.getValidatedAt()).trim();
    const serverUrl = await resolveServerUrl();
    return {
      plan: entitlement.plan,
      maxActiveWorkers: entitlement.maxActiveWorkers,
      activeWorkers,
      expiresAt: entitlement.expiresAt,
      licenseKeyLast4: entitlement.licenseKeyLast4 ?? maskLicenseKey(storedKey),
      machineId: await resolveMachineId(),
      canActivate: true,
      lastValidatedAt: validatedAt || null,
      licenseServerUrl: serverUrl,
    };
  };

  return {
    getEntitlement: async () => {
      const stored = parseStoredEntitlement(await storage.getEntitlementJson());
      return stored ?? freeEntitlement();
    },

    getMaxActiveWorkers: async () => {
      const stored = parseStoredEntitlement(await storage.getEntitlementJson());
      const entitlement = stored ?? freeEntitlement();
      return resolveMaxActiveWorkers(entitlement.plan);
    },

    getStatus: async (activeWorkerCount) => {
      const entitlement =
        parseStoredEntitlement(await storage.getEntitlementJson()) ?? freeEntitlement();
      return buildStatus(entitlement, activeWorkerCount);
    },

    activate: async (licenseKey) => {
      const trimmed = licenseKey.trim();
      if (!trimmed) {
        return { success: false, message: "License key is required" };
      }

      const machineId = await resolveMachineId();

      if (isSignedLicenseKey(trimmed)) {
        const entitlement = verifySignedLicenseKey(trimmed);
        if (!entitlement) {
          return { success: false, message: "Invalid or expired license key" };
        }
        await persistActivation(trimmed, entitlement);
        const activeWorkers = await agentRepository.countActive();
        return { success: true, status: await buildStatus(entitlement, activeWorkers, trimmed) };
      }

      return activateLocalLemonSqueezy(trimmed, machineId);
    },

    clear: async () => {
      await storage.clearLicense();
      const activeWorkers = await agentRepository.countActive();
      return buildStatus(freeEntitlement(), activeWorkers);
    },
  };
};

export type WorkerLimitAssertResult =
  | { allowed: true }
  | { allowed: false; limit: number }
  | { allowed: false; message: string };

export const assertWithinWorkerLimit = async (
  storage: LicenseStorage,
  activeCount: number,
): Promise<WorkerLimitAssertResult> => {
  const check = await assertWithinWorkerLimitWithRefresh({
    storage,
    resolveServerUrl: async () => {
      const configured = (await storage.getServerUrl()).trim();
      return configured || process.env.AOP_LICENSE_SERVER_URL?.trim() || DEFAULT_LICENSE_SERVER_URL;
    },
    resolveMachineId: async () => {
      const stored = (await storage.getMachineId()).trim();
      if (stored) {
        return stored;
      }
      const machineId = getMachineId();
      await storage.setMachineId(machineId);
      return machineId;
    },
    activeCount,
  });

  if (check.allowed) {
    return { allowed: true };
  }
  if (check.reason === "limit") {
    return { allowed: false, limit: check.limit };
  }
  return { allowed: false, message: check.message };
};
