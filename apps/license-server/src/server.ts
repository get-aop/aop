import { getLogger } from "@aop/infra";
import { activateLicenseKey, validateLicenseKey } from "@aop/license";
import { Hono } from "hono";

const SERVICE_NAME = "license-server";
const logger = getLogger(SERVICE_NAME);
const app = new Hono();
const HEALTH_RESPONSE = { ok: true } as const;

const readActivationBody = async (c: {
  req: { json: () => Promise<unknown> };
}): Promise<{ licenseKey: string; machineId: string; lemonInstanceId?: string } | null> => {
  const body = (await c.req.json()) as {
    licenseKey?: string;
    machineId?: string;
    lemonInstanceId?: string;
  };
  const licenseKey = body.licenseKey?.trim() ?? "";
  const machineId = body.machineId?.trim() ?? "";
  if (!licenseKey || !machineId) {
    return null;
  }
  return {
    licenseKey,
    machineId,
    lemonInstanceId: body.lemonInstanceId?.trim() || undefined,
  };
};

app.get("/health", (c) => c.json(HEALTH_RESPONSE));

app.post("/v1/activate", async (c) => {
  const body = await readActivationBody(c);
  if (!body) {
    return c.json({ error: "licenseKey and machineId are required" }, 400);
  }

  const result = await activateLicenseKey({
    ...body,
    lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY,
  });

  if (!result.success) {
    logger.info("License activation failed: {message}", { message: result.message });
    return c.json({ error: result.message }, 400);
  }

  return c.json({
    entitlement: result.entitlement,
    lemonInstanceId: result.lemonInstanceId,
  });
});

app.post("/v1/validate", async (c) => {
  const body = await readActivationBody(c);
  if (!body) {
    return c.json({ error: "licenseKey and machineId are required" }, 400);
  }

  const result = await validateLicenseKey({
    ...body,
    lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY,
  });

  if (!result.success) {
    logger.info("License validation failed: {message}", { message: result.message });
    return c.json({ error: result.message }, 400);
  }

  return c.json({
    entitlement: result.entitlement,
    lemonInstanceId: result.lemonInstanceId,
  });
});

const port = Number.parseInt(process.env.PORT ?? "4320", 10);
const hostname = process.env.HOST ?? "0.0.0.0";

logger.info("License server listening on {hostname}:{port}", { hostname, port });
export default {
  port,
  hostname,
  fetch: app.fetch,
};
