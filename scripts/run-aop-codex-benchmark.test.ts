import { afterEach, describe, expect, test } from "bun:test";
import { parseBenchmarkWorkflowName, parseScenarioArg } from "./run-aop-codex-benchmark.ts";

describe("run-aop-codex-benchmark", () => {
  test("parseScenarioArg reads explicit scenario overrides", () => {
    expect(parseScenarioArg(["--scenario=notes-cli"])).toBe("notes-cli");
  });

  afterEach(() => {
    delete process.env.AOP_BENCHMARK_WORKFLOW;
  });

  test("parseBenchmarkWorkflowName defaults to aop-default-gpt", () => {
    expect(parseBenchmarkWorkflowName([])).toBe("aop-default-gpt");
  });

  test("parseBenchmarkWorkflowName reads explicit workflow overrides", () => {
    expect(parseBenchmarkWorkflowName(["--workflow=custom-fast"])).toBe("custom-fast");
  });

  test("parseBenchmarkWorkflowName reads env workflow overrides", () => {
    process.env.AOP_BENCHMARK_WORKFLOW = "custom-fast";

    expect(parseBenchmarkWorkflowName([])).toBe("custom-fast");
  });
});
