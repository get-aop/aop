import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import * as messageAttachments from "./message-images.ts";
import {
  buildRuntimePrompt,
  chatSessionAttachmentsDir,
  decodeMessageContent,
  encodeMessageContent,
  expandStoredPastes,
  isSafeAttachmentFileName,
  materializeChatImages,
  validateChatImageAttachments,
} from "./message-images.ts";

type ValidateDocuments = (documents: unknown) =>
  | {
      success: true;
      documents: Array<{ id: string; fileName: string; mimeType: string; dataBase64: string }>;
    }
  | { success: false; error: string };

const validateChatDocumentAttachments = Reflect.get(
  messageAttachments,
  "validateChatDocumentAttachments",
) as ValidateDocuments | undefined;

type StoredDocument = {
  id: string;
  mimeType: "text/markdown" | "text/plain" | "text/csv" | "text/tab-separated-values";
  fileName: string;
  originalFileName: string;
};

type MaterializeDocuments = (
  sessionId: string,
  messageId: string,
  documents: Array<{
    id: string;
    fileName: string;
    mimeType: "text/markdown" | "text/plain" | "text/csv" | "text/tab-separated-values";
    dataBase64: string;
  }>,
) => Promise<StoredDocument[]>;

const materializeChatDocuments = Reflect.get(messageAttachments, "materializeChatDocuments") as
  | MaterializeDocuments
  | undefined;

const originalHome = process.env.AOP_HOME;
let home: string;

beforeEach(async () => {
  home = join(process.env.TMPDIR ?? "/tmp", `aop-chat-img-${crypto.randomUUID()}`);
  process.env.AOP_HOME = home;
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.AOP_HOME;
  } else {
    process.env.AOP_HOME = originalHome;
  }
  await rm(home, { recursive: true, force: true });
});

describe("validateChatImageAttachments", () => {
  test("accepts empty / undefined", () => {
    expect(validateChatImageAttachments(undefined)).toEqual({ success: true, images: [] });
    expect(validateChatImageAttachments([])).toEqual({ success: true, images: [] });
  });

  test("rejects invalid base64 and oversize counts", () => {
    expect(validateChatImageAttachments("nope").success).toBe(false);
    expect(
      validateChatImageAttachments([
        { id: "a", mimeType: "image/png", dataBase64: "not-base64!!!" },
      ]).success,
    ).toBe(false);
    expect(
      validateChatImageAttachments(
        Array.from({ length: 6 }, (_, i) => ({
          id: `i${i}`,
          mimeType: "image/png",
          dataBase64: Buffer.from("x").toString("base64"),
        })),
      ).success,
    ).toBe(false);
  });

  test("accepts a valid png payload", () => {
    const result = validateChatImageAttachments([
      {
        id: "img1",
        mimeType: "image/png",
        dataBase64: Buffer.from("png-bytes").toString("base64"),
      },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.images).toHaveLength(1);
      expect(result.images[0]?.id).toBe("img1");
    }
  });
});

describe("validateChatDocumentAttachments", () => {
  test("accepts Markdown and plain-text documents", () => {
    expect(validateChatDocumentAttachments).toBeFunction();
    if (!validateChatDocumentAttachments) return;

    const result = validateChatDocumentAttachments([
      {
        id: "doc1",
        fileName: "login-fix.md",
        mimeType: "text/markdown",
        dataBase64: Buffer.from("# Login fix").toString("base64"),
      },
      {
        id: "doc2",
        fileName: "notes.txt",
        mimeType: "text/plain",
        dataBase64: Buffer.from("Notes").toString("base64"),
      },
    ]);

    expect(result).toEqual({
      success: true,
      documents: [
        expect.objectContaining({ id: "doc1", fileName: "login-fix.md" }),
        expect.objectContaining({ id: "doc2", fileName: "notes.txt" }),
      ],
    });
  });

  test("accepts CSV and TSV documents", () => {
    expect(validateChatDocumentAttachments).toBeFunction();
    if (!validateChatDocumentAttachments) return;

    const result = validateChatDocumentAttachments([
      {
        id: "csv1",
        fileName: "report.csv",
        mimeType: "text/csv",
        dataBase64: Buffer.from("name,value\na,1").toString("base64"),
      },
      {
        id: "tsv1",
        fileName: "report.tsv",
        mimeType: "text/tab-separated-values",
        dataBase64: Buffer.from("name\tvalue\na\t1").toString("base64"),
      },
    ]);

    expect(result.success).toBe(true);
  });

  test("rejects unsupported, oversized, and excess documents", () => {
    expect(validateChatDocumentAttachments).toBeFunction();
    if (!validateChatDocumentAttachments) return;
    const encoded = Buffer.from("document").toString("base64");

    expect(
      validateChatDocumentAttachments([
        { id: "doc", fileName: "plan.pdf", mimeType: "application/pdf", dataBase64: encoded },
      ]).success,
    ).toBe(false);
    expect(
      validateChatDocumentAttachments([
        { id: "doc", fileName: "plan.exe", mimeType: "text/plain", dataBase64: encoded },
      ]).success,
    ).toBe(false);
    expect(
      validateChatDocumentAttachments(
        Array.from({ length: 3 }, (_, index) => ({
          id: `doc${index}`,
          fileName: `plan-${index}.md`,
          mimeType: "text/markdown",
          dataBase64: encoded,
        })),
      ).success,
    ).toBe(false);
    expect(
      validateChatDocumentAttachments([
        {
          id: "large",
          fileName: "large.md",
          mimeType: "text/markdown",
          dataBase64: Buffer.alloc(256 * 1024 + 1, "x").toString("base64"),
        },
      ]).success,
    ).toBe(false);
  });
});

describe("materialize + encode/decode", () => {
  test("writes files and round-trips message metadata", async () => {
    const sessionId = "isess_test";
    const messageId = "smsg_abc123";
    const stored = await materializeChatImages(sessionId, messageId, [
      {
        id: "img1",
        mimeType: "image/png",
        dataBase64: Buffer.from("hello-png").toString("base64"),
      },
    ]);

    expect(stored).toHaveLength(1);
    const fileName = stored[0]?.fileName ?? "";
    expect(fileName).toBe(`${messageId}-1.png`);
    expect(await readFile(join(chatSessionAttachmentsDir(sessionId), fileName), "utf8")).toBe(
      "hello-png",
    );
    expect(chatSessionAttachmentsDir(sessionId)).toContain(aopPaths.logs());

    const encoded = encodeMessageContent("Look at this", stored);
    const decoded = decodeMessageContent(encoded, sessionId);
    expect(decoded.text).toBe("Look at this");
    expect(decoded.images).toEqual([
      {
        id: "img1",
        mimeType: "image/png",
        url: `/api/chat-sessions/${sessionId}/attachments/${fileName}`,
      },
    ]);

    const prompt = buildRuntimePrompt("Look at this", sessionId, stored);
    expect(prompt).toContain("#image1:");
    expect(prompt).toContain(join(chatSessionAttachmentsDir(sessionId), fileName));
    expect(prompt).not.toContain("aop-chat-images");
  });

  test("safe attachment file names reject path traversal", () => {
    expect(isSafeAttachmentFileName("smsg_abc-1.png")).toBe(true);
    expect(isSafeAttachmentFileName("../etc/passwd")).toBe(false);
    expect(isSafeAttachmentFileName("smsg_abc-1.png/../x")).toBe(false);
  });

  test("gently prefers AOP MCP tools for platform actions without attachments", () => {
    const prompt = buildRuntimePrompt("Create a task", "isess_plain", []);
    expect(prompt).toContain("For AOP platform actions (workflows), prefer the `aop` MCP tools.");
    expect(prompt).not.toContain("aop_create_task");
  });

  test("injects optional global instructions into the runtime prompt only", () => {
    const prompt = buildRuntimePrompt(
      "Ship the fix",
      "isess_prefs",
      [],
      [],
      [],
      "Be concise.\nNo jargon.",
    );
    expect(prompt).toContain("Ship the fix");
    expect(prompt).toContain(
      "Apply these user preferences for this entire turn (do not mention them unless asked):",
    );
    expect(prompt).toContain("Be concise.\nNo jargon.");
    expect(buildRuntimePrompt("Ship the fix", "isess_prefs", [], [], [], "   ")).not.toContain(
      "user preferences",
    );
  });

  test("stores compact paste tokens and expands them for runtime prompts", () => {
    const display = "review\n[paste #1 +3 lines]\nplease";
    const pastes = [{ index: 1, lineCount: 3, content: "one\ntwo\nthree" }];
    const encoded = encodeMessageContent(display, [], [], [], pastes);
    const decoded = decodeMessageContent(encoded, "isess_paste");
    expect(decoded.text).toBe(display);
    expect(decoded.pastes).toEqual(pastes);
    expect(expandStoredPastes(decoded.text, decoded.pastes)).toBe(
      "review\none\ntwo\nthree\nplease",
    );
    const prompt = buildRuntimePrompt(display, "isess_paste", [], [], pastes);
    expect(prompt).toContain("one\ntwo\nthree");
    expect(prompt).not.toContain("[paste #1 +3 lines]");
  });

  test("writes document files and includes them in stored metadata and runtime prompts", async () => {
    expect(materializeChatDocuments).toBeFunction();
    if (!materializeChatDocuments) return;
    const sessionId = "isess_documents";
    const messageId = "smsg_docs123";
    const documents = await materializeChatDocuments(sessionId, messageId, [
      {
        id: "doc1",
        fileName: "login-fix.md",
        mimeType: "text/markdown",
        dataBase64: Buffer.from("# Login fix").toString("base64"),
      },
    ]);

    expect(documents).toEqual([
      {
        id: "doc1",
        mimeType: "text/markdown",
        fileName: `${messageId}-document-1.md`,
        originalFileName: "login-fix.md",
      },
    ]);
    expect(
      await readFile(
        join(chatSessionAttachmentsDir(sessionId), documents[0]?.fileName ?? ""),
        "utf8",
      ),
    ).toBe("# Login fix");

    const encoded = encodeMessageContent("Create a task", [], documents);
    const decoded = decodeMessageContent(encoded, sessionId);
    expect(decoded).toMatchObject({
      text: "Create a task",
      images: [],
      documents: [
        {
          id: "doc1",
          mimeType: "text/markdown",
          fileName: "login-fix.md",
          url: `/api/chat-sessions/${sessionId}/attachments/${messageId}-document-1.md`,
        },
      ],
    });

    const prompt = buildRuntimePrompt("Create a task", sessionId, [], documents);
    expect(prompt).toContain("## Attached Documents");
    expect(prompt).toContain("#document1 (login-fix.md)");
    expect(prompt).not.toContain("aop_create_task");
    expect(prompt).not.toContain("planMarkdown");
    expect(prompt).not.toContain("prdMarkdown");
    expect(prompt).not.toContain("issuesMarkdown");
    expect(prompt).not.toContain("planFileName");
    expect(prompt).toContain(
      join(chatSessionAttachmentsDir(sessionId), `${messageId}-document-1.md`),
    );
    expect(isSafeAttachmentFileName(`${messageId}-document-1.md`)).toBe(true);
  });

  test("preserves CSV and TSV extensions when materializing documents", async () => {
    expect(materializeChatDocuments).toBeFunction();
    if (!materializeChatDocuments) return;

    const documents = await materializeChatDocuments("isess_data", "smsg_data", [
      {
        id: "csv1",
        fileName: "report.csv",
        mimeType: "text/csv",
        dataBase64: Buffer.from("a,b").toString("base64"),
      },
      {
        id: "tsv1",
        fileName: "report.tsv",
        mimeType: "text/tab-separated-values",
        dataBase64: Buffer.from("a\tb").toString("base64"),
      },
    ]);

    expect(documents.map((document) => document.fileName)).toEqual([
      "smsg_data-document-1.csv",
      "smsg_data-document-2.tsv",
    ]);
    expect(isSafeAttachmentFileName("smsg_data-document-1.csv")).toBe(true);
    expect(isSafeAttachmentFileName("smsg_data-document-2.tsv")).toBe(true);
  });

  test("stores structured Markdown artifacts with an assistant message", () => {
    const artifacts = [
      {
        path: "/repo/presentation-prep.md",
        mimeType: "text/markdown" as const,
      },
    ];

    const encoded = encodeMessageContent("Your prep is ready.", [], [], artifacts);

    expect(decodeMessageContent(encoded, "isess_artifacts")).toEqual({
      text: "Your prep is ready.",
      images: [],
      documents: [],
      artifacts,
      pastes: [],
    });
  });
});
