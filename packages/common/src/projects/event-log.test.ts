import { describe, expect, test } from "bun:test";
import { EventLogEntrySchema } from "./event-log.ts";
import {
  makeAssistantMessage,
  makeProject,
  makeThread,
  makeUserMessage,
  rejectedPaths,
} from "./test-utils.ts";

const makeEntry = (type: string, payload: unknown, overrides: Record<string, unknown> = {}) => ({
  id: 41,
  projectId: "prj_1",
  type,
  payload,
  ...overrides,
});

const validEntries: [string, unknown][] = [
  ["project.upserted", { project: makeProject() }],
  ["project.removed", {}],
  ["thread.upserted", { thread: makeThread() }],
  ["thread.removed", { threadId: "thr_1" }],
  ["message.created", { message: makeUserMessage() }],
  ["message.created", { message: makeAssistantMessage() }],
];

describe("EventLogEntrySchema", () => {
  test.each(validEntries)("accepts a %s entry", (type, payload) => {
    expect(EventLogEntrySchema.parse(makeEntry(type, payload)).type).toBe(type as never);
  });

  test("rejects an unknown event type", () => {
    expect(rejectedPaths(EventLogEntrySchema, makeEntry("thread.exploded", {}))).toEqual(["type"]);
  });

  test("rejects a payload that belongs to a different type", () => {
    const wrong = makeEntry("thread.upserted", { message: makeUserMessage() });
    expect(rejectedPaths(EventLogEntrySchema, wrong)).toEqual(["payload.thread"]);
  });

  test("rejects a payload entity that fails its own schema, naming the field", () => {
    const badThread = makeThread({ status: "working", blockedQuestion: { question: "x" } });
    const paths = rejectedPaths(
      EventLogEntrySchema,
      makeEntry("thread.upserted", { thread: badThread }),
    );
    expect(paths).toEqual(["payload.thread.blockedQuestion"]);
  });

  test.each([0, -1, 1.5, "41", null])("rejects id %p, which cannot be a resume cursor", (id) => {
    const entry = makeEntry("thread.removed", { threadId: "thr_1" }, { id });
    expect(rejectedPaths(EventLogEntrySchema, entry)).toEqual(["id"]);
  });

  test("rejects an entry with no project scope", () => {
    const entry = makeEntry("thread.removed", { threadId: "thr_1" }, { projectId: "" });
    expect(rejectedPaths(EventLogEntrySchema, entry)).toEqual(["projectId"]);
  });

  describe("the entry's project must be the project of the entity it carries", () => {
    test("rejects a thread from another project", () => {
      const entry = makeEntry("thread.upserted", { thread: makeThread({ projectId: "prj_2" }) });
      expect(EventLogEntrySchema.safeParse(entry).success).toBe(false);
    });

    test("rejects a message from another project", () => {
      const entry = makeEntry("message.created", {
        message: makeUserMessage({ projectId: "prj_2" }),
      });
      expect(EventLogEntrySchema.safeParse(entry).success).toBe(false);
    });

    test("rejects a project entry for another project's id", () => {
      const entry = makeEntry("project.upserted", { project: makeProject({ id: "prj_2" }) });
      expect(EventLogEntrySchema.safeParse(entry).success).toBe(false);
    });

    test("accepts the same entities under their own project", () => {
      const entry = makeEntry(
        "thread.upserted",
        { thread: makeThread({ projectId: "prj_2" }) },
        { projectId: "prj_2" },
      );
      expect(EventLogEntrySchema.safeParse(entry).success).toBe(true);
    });
  });

  test("replaying a serialized entry parses back to the same entry", () => {
    const entry = EventLogEntrySchema.parse(makeEntry("thread.upserted", { thread: makeThread() }));
    expect(EventLogEntrySchema.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });
});
