import { afterEach, describe, expect, test } from "bun:test";
import { trace } from "@opentelemetry/api";
import { getActiveSpanId, getActiveTraceId, initTracing, resetTracing } from "./tracing.ts";

afterEach(() => {
  resetTracing();
});

describe("initTracing", () => {
  test("uses the OpenTelemetry 2.x resource factory API", async () => {
    const source = await Bun.file(new URL("./tracing.ts", import.meta.url)).text();
    expect(source).toContain("resourceFromAttributes");
    expect(source).not.toContain("new Resource");
  });

  test("initializes a tracer provider for the given service", () => {
    const provider = initTracing("test-service");
    expect(provider).toBeDefined();
  });

  test("returns the same provider on repeated calls", () => {
    const first = initTracing("test-service");
    const second = initTracing("test-service");
    expect(first).toBe(second);
  });
});

describe("getActiveTraceId / getActiveSpanId", () => {
  test("returns undefined when no span is active", () => {
    expect(getActiveTraceId()).toBeUndefined();
    expect(getActiveSpanId()).toBeUndefined();
  });

  test("returns trace/span IDs inside an active span", () => {
    initTracing("test-service");
    const tracer = trace.getTracer("test");

    tracer.startActiveSpan("test-span", (span) => {
      const traceId = getActiveTraceId();
      const spanId = getActiveSpanId();

      expect(traceId).toBeDefined();
      expect(traceId).toHaveLength(32);
      expect(spanId).toBeDefined();
      expect(spanId).toHaveLength(16);

      span.end();
    });
  });

  test("returns undefined after span ends and context exits", () => {
    initTracing("test-service");
    const tracer = trace.getTracer("test");

    tracer.startActiveSpan("test-span", (span) => {
      span.end();
    });

    expect(getActiveTraceId()).toBeUndefined();
    expect(getActiveSpanId()).toBeUndefined();
  });
});
