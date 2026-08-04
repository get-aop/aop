import { activateLemonSqueezyLicense, validateLemonSqueezyLicense } from "./lemonsqueezy.ts";
import { isSignedLicenseKey, verifySignedLicenseKey } from "./signed-license.ts";
import type { LicenseEntitlement } from "./types.ts";

export type ResolveLicenseKeyResult =
  | { success: true; entitlement: LicenseEntitlement; lemonInstanceId?: string }
  | { success: false; message: string };

export const activateLicenseKey = async (options: {
  licenseKey: string;
  machineId: string;
  lemonSqueezyApiKey?: string;
}): Promise<ResolveLicenseKeyResult> => {
  const licenseKey = options.licenseKey.trim();
  if (!licenseKey) {
    return { success: false, message: "License key is required" };
  }

  if (isSignedLicenseKey(licenseKey)) {
    const entitlement = verifySignedLicenseKey(licenseKey);
    if (!entitlement) {
      return { success: false, message: "Invalid or expired signed license key" };
    }
    return { success: true, entitlement };
  }

  const apiKey = options.lemonSqueezyApiKey?.trim();
  if (!apiKey) {
    return {
      success: false,
      message:
        "Store-issued license keys require the hosted license server (Lemon Squeezy not configured)",
    };
  }

  const result = await activateLemonSqueezyLicense({
    apiKey,
    licenseKey,
    machineId: options.machineId,
  });
  if (!result.success) {
    return { success: false, message: result.message };
  }

  return {
    success: true,
    entitlement: result.entitlement,
    lemonInstanceId: result.lemonInstanceId,
  };
};

export const validateLicenseKey = async (options: {
  licenseKey: string;
  machineId: string;
  lemonInstanceId?: string;
  lemonSqueezyApiKey?: string;
}): Promise<ResolveLicenseKeyResult> => {
  const licenseKey = options.licenseKey.trim();
  if (!licenseKey) {
    return { success: false, message: "License key is required" };
  }

  if (isSignedLicenseKey(licenseKey)) {
    const entitlement = verifySignedLicenseKey(licenseKey);
    if (!entitlement) {
      return { success: false, message: "Invalid or expired signed license key" };
    }
    return { success: true, entitlement };
  }

  const apiKey = options.lemonSqueezyApiKey?.trim();
  if (!apiKey) {
    return {
      success: false,
      message:
        "Store-issued license keys require the hosted license server (Lemon Squeezy not configured)",
    };
  }

  const result = await validateLemonSqueezyLicense({
    apiKey,
    licenseKey,
    machineId: options.machineId,
    lemonInstanceId: options.lemonInstanceId,
  });
  if (!result.success) {
    return { success: false, message: result.message };
  }

  return {
    success: true,
    entitlement: result.entitlement,
    lemonInstanceId: result.lemonInstanceId,
  };
};
