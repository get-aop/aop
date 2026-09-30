import type { Device } from "@aop/common";

export const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: "dev_1",
  name: "Work laptop",
  createdAt: "2026-09-29T10:00:00.000Z",
  lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...overrides,
});
