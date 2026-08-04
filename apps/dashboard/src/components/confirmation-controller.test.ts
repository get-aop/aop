import { describe, expect, test } from "bun:test";
import { type ConfirmationRequest, createConfirmationController } from "./confirmation-controller";

const deferredRequest = () => {
  let resolve!: (value: boolean) => void;
  const result = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  return { request: { title: "Confirm", message: "Confirm", resolve }, result };
};

describe("confirmation controller", () => {
  test("settles a replaced request as false", async () => {
    const controller = createConfirmationController(() => {});
    const first = deferredRequest();
    const second = deferredRequest();
    controller.request(first.request);
    controller.request(second.request);
    expect(await first.result).toBe(false);
  });

  test("settles a pending request as false on disposal", async () => {
    const controller = createConfirmationController(() => {});
    const pending = deferredRequest();
    controller.request(pending.request as ConfirmationRequest);
    controller.dispose();
    expect(await pending.result).toBe(false);
  });
});
