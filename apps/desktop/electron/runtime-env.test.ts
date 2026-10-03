import { describe, expect, mock, test } from "bun:test";
import { portFromEnv, sleep, timer } from "./runtime-env";

describe("portFromEnv", () => {
  test("takes a port, and nothing that is not one", () => {
    expect(portFromEnv("25360")).toBe(25360);
    for (const value of [undefined, "", "0", "70000", "25.5", "port"]) {
      expect(portFromEnv(value)).toBeNull();
    }
  });
});

describe("timer", () => {
  test("runs once the delay is over, unless cancelled first", async () => {
    const ran = mock(() => {});
    const cancelled = mock(() => {});

    timer(ran, 0);
    timer(cancelled, 0)();
    await sleep(5);

    expect(ran).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
