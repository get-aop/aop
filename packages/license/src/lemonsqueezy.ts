import { z } from "zod";
import type { LicensePlan } from "./plans.ts";
import { resolveMaxActiveWorkers } from "./plans.ts";
import type { LicenseEntitlement } from "./types.ts";

const ActivateResponseSchema = z.object({
  activated: z.boolean(),
  error: z.string().nullable().optional(),
  license_key: z
    .object({
      id: z.number(),
      status: z.string(),
      key: z.string(),
      activation_limit: z.number().nullable(),
      activation_usage: z.number().nullable(),
      expires_at: z.string().nullable(),
      created_at: z.string(),
    })
    .optional(),
  instance: z
    .object({
      id: z.string(),
      name: z.string(),
      created_at: z.string(),
    })
    .optional(),
  meta: z
    .object({
      store_id: z.number(),
      order_id: z.number(),
      order_item_id: z.number(),
      variant_id: z.number().nullable(),
      variant_name: z.string().nullable(),
      product_id: z.number().nullable(),
      product_name: z.string().nullable(),
    })
    .optional(),
});

export type LemonSqueezyActivateResult =
  | { success: true; entitlement: LicenseEntitlement; lemonInstanceId?: string }
  | { success: false; message: string };

const inferPlanFromVariantName = (variantName: string | null | undefined): LicensePlan => {
  const normalized = (variantName ?? "").toLowerCase();
  if (normalized.includes("team") || normalized.includes("unlimited")) {
    return "team";
  }
  if (normalized.includes("pro")) {
    return "pro";
  }
  return "pro";
};

export const activateLemonSqueezyLicense = async (options: {
  apiKey: string;
  licenseKey: string;
  machineId: string;
}): Promise<LemonSqueezyActivateResult> => {
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      license_key: options.licenseKey.trim(),
      instance_name: options.machineId,
    }),
  });

  const body = (await response.json()) as unknown;
  const parsed = ActivateResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { success: false, message: "Invalid Lemon Squeezy license response" };
  }

  if (!parsed.data.activated) {
    return {
      success: false,
      message: parsed.data.error ?? "License activation failed",
    };
  }

  const plan = inferPlanFromVariantName(parsed.data.meta?.variant_name);
  const expiresAt = parsed.data.license_key?.expires_at ?? null;

  return {
    success: true,
    entitlement: {
      plan,
      maxActiveWorkers: resolveMaxActiveWorkers(plan),
      expiresAt,
      licenseKeyLast4: options.licenseKey.trim().slice(-4),
      source: "lemonsqueezy",
    },
    lemonInstanceId: parsed.data.instance?.id,
  };
};

export const validateLemonSqueezyLicense = async (options: {
  apiKey: string;
  licenseKey: string;
  machineId: string;
  lemonInstanceId?: string;
}): Promise<LemonSqueezyActivateResult> => {
  const instanceId = options.lemonInstanceId?.trim();
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      license_key: options.licenseKey.trim(),
      ...(instanceId ? { instance_id: instanceId } : { instance_name: options.machineId }),
    }),
  });

  const body = (await response.json()) as unknown;
  const parsed = ActivateResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.activated) {
    return {
      success: false,
      message: parsed.success ? (parsed.data.error ?? "License is not valid") : "Invalid response",
    };
  }

  const plan = inferPlanFromVariantName(parsed.data.meta?.variant_name);
  return {
    success: true,
    entitlement: {
      plan,
      maxActiveWorkers: resolveMaxActiveWorkers(plan),
      expiresAt: parsed.data.license_key?.expires_at ?? null,
      licenseKeyLast4: options.licenseKey.trim().slice(-4),
      source: "lemonsqueezy",
    },
    lemonInstanceId: parsed.data.instance?.id ?? instanceId,
  };
};
