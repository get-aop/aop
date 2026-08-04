import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { chatSessionAttachmentsDir } from "./message-images.ts";
import {
  claimNextQueuedSteer,
  decodeStoredImages,
  isChatSessionBusy,
  storeSteerUserMessage,
} from "./steer-queue.ts";

describe("steer-queue", () => {
  test("decodeStoredImages rehydrates plain text and attachment metadata", () => {
    expect(decodeStoredImages("hello")).toEqual({
      text: "hello",
      images: [],
      documents: [],
      artifacts: [],
      pastes: [],
    });
    const encoded =
      'caption\n\n<!--aop-chat-images:[{"id":"img1","mimeType":"image/png","fileName":"smsg_x-1.png"}]-->';
    expect(decodeStoredImages(encoded)).toEqual({
      text: "caption",
      images: [{ id: "img1", mimeType: "image/png", fileName: "smsg_x-1.png" }],
      documents: [],
      artifacts: [],
      pastes: [],
    });

    const documentEncoded =
      'create task\n\n<!--aop-chat-attachments:{"images":[],"documents":[{"id":"doc1","mimeType":"text/markdown","fileName":"smsg_x-document-1.md","originalFileName":"login-fix.md"}]}-->';
    expect(decodeStoredImages(documentEncoded)).toEqual({
      text: "create task",
      images: [],
      documents: [
        {
          id: "doc1",
          mimeType: "text/markdown",
          fileName: "smsg_x-document-1.md",
          originalFileName: "login-fix.md",
        },
      ],
      artifacts: [],
      pastes: [],
    });
  });

  test("storeSteerUserMessage persists without a chat_run", async () => {
    const cleanupHome = useTestAopHome();
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo_steer", "/tmp/steer-repo");
    const now = new Date().toISOString();
    const session = await ctx.chatSessionRepository.create({
      id: "sess_steer_1",
      repo_id: "repo_steer",
      title: "Steer test",
      named: false,
      runtime: "claude-code",
      model: "claude-sonnet-4-6",
      reasoning_effort: "medium",
      runtime_alias: null,
      runtime_session_id: null,
      runtime_configuration_id: null,
      fast_mode: false,
      default_worker_id: null,
      default_workflow_id: null,
      pinned: false,
      settled_override: "active",
      settled_at: "2026-01-01T00:00:00.000Z",
      created_at: now,
      updated_at: now,
    });

    const stored = await storeSteerUserMessage(
      ctx,
      session.id,
      {
        content: "Please also update the README",
        documentAttachments: [
          {
            id: "doc_plan",
            fileName: "implementation-plan.md",
            mimeType: "text/markdown",
            dataBase64: Buffer.from("# Implementation Plan\n\nShip it.").toString("base64"),
          },
        ],
      },
      "queued",
    );
    expect(stored.success).toBe(true);
    if (!stored.success) return;
    expect(stored.session.settled_override).toBeNull();
    expect(stored.session.settled_at).toBeNull();

    await db
      .insertInto("chat_messages")
      .values({
        id: "assistant_before_queued",
        session_id: session.id,
        role: "assistant",
        content: "Finished the current reply",
        action: null,
        created_at: new Date().toISOString(),
      })
      .execute();

    const runs = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", session.id)
      .execute();
    expect(runs).toHaveLength(0);

    const claimed = await claimNextQueuedSteer(ctx, session.id, new Set());
    expect(claimed.success).toBe(true);
    if (!claimed.success) return;
    expect(claimed.displayText).toBe("Please also update the README");
    expect(claimed.documents).toEqual([
      expect.objectContaining({
        id: "doc_plan",
        originalFileName: "implementation-plan.md",
      }),
    ]);
    expect(claimed.runtimePrompt).toContain("implementation-plan.md");
    expect(claimed.runtimePrompt).toContain("#document1");
    expect(
      await readFile(
        join(chatSessionAttachmentsDir(session.id), claimed.documents[0]?.fileName ?? ""),
        "utf8",
      ),
    ).toBe("# Implementation Plan\n\nShip it.");
    expect(claimed.run.status).toBe("running");
    expect(claimed.userMessage.disposition).toBe("immediate");

    const orderedMessages = await ctx.chatSessionRepository.listMessages(session.id);
    expect(orderedMessages.map((message) => message.id)).toEqual([
      "assistant_before_queued",
      stored.userMessage.id,
    ]);

    // Busy while run is open.
    expect(await isChatSessionBusy(ctx, session.id, new Set())).toBe(true);
    // Nothing left to claim.
    expect((await claimNextQueuedSteer(ctx, session.id, new Set(["sess_steer_1"]))).success).toBe(
      false,
    );

    await db.destroy();
    cleanupHome();
  });
});
