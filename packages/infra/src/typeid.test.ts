import { describe, expect, test } from "bun:test";
import { generateTypeId, typeIdFromUuid, typeIdToUuid } from "./typeid";

describe("generateTypeId", () => {
  test("generates a valid typeid with the given prefix", () => {
    const id = generateTypeId("repo");
    expect(id).toMatch(/^repo_[0-9a-z]{26}$/);
  });

  test("generates unique IDs", () => {
    const id1 = generateTypeId("isess");
    const id2 = generateTypeId("isess");
    expect(id1).not.toBe(id2);
  });

  test("supports different prefixes", () => {
    const chatRunId = generateTypeId("crun");
    const messageId = generateTypeId("smsg");
    const projectId = generateTypeId("proj");

    expect(chatRunId).toMatch(/^crun_[0-9a-z]{26}$/);
    expect(messageId).toMatch(/^smsg_[0-9a-z]{26}$/);
    expect(projectId).toMatch(/^proj_[0-9a-z]{26}$/);
  });
});

describe("TypeIDs as UUIDs", () => {
  test("a message id goes to a UUID and back", () => {
    const id = generateTypeId("smsg");
    const uuid = typeIdToUuid(id);

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(typeIdFromUuid("smsg", uuid ?? "")).toBe(id);
  });

  test("something that is not a UUID gives no id, and something that is not a TypeID no UUID", () => {
    expect(typeIdFromUuid("smsg", "fake-1-0")).toBeNull();
    expect(typeIdToUuid("smsg_handwritten")).toBeNull();
  });
});
