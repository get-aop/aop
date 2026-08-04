import { describe, expect, test } from "bun:test";
import { CREATE_TASK_IMAGE_LIMITS } from "@aop/common";
import { mergeLocalCreateTaskImages } from "./create-task-images.ts";

const sampleImage = (id: string) => ({
  id,
  mimeType: "image/png" as const,
  dataBase64: "aGVsbG8=",
  previewUrl: `blob:mock-${id}`,
});

describe("create-task-images", () => {
  test("mergeLocalCreateTaskImages enforces max count", () => {
    const current = Array.from({ length: CREATE_TASK_IMAGE_LIMITS.maxCount }, (_, index) =>
      sampleImage(`existing-${index}`),
    );
    const incoming = [sampleImage("incoming")];

    const merged = mergeLocalCreateTaskImages(current, incoming);

    expect(typeof merged).toBe("string");
    expect(merged).toContain("At most");
  });
});
