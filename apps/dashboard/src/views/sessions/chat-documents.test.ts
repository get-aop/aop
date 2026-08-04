import { describe, expect, test } from "bun:test";
import { fileToChatDocument, mergeChatDocuments } from "./chat-documents";

describe("chat documents", () => {
  test("encodes accepted source documents", async () => {
    const document = await fileToChatDocument(
      new File(["# Plan"], "delivery.md", { type: "text/markdown" }),
    );
    expect(document.fileName).toBe("delivery.md");
    expect(atob(document.dataBase64)).toBe("# Plan");
  });

  test("encodes CSV and TSV data files without relying on the browser MIME type", async () => {
    const csv = await fileToChatDocument(new File(["name,value\na,1"], "report.csv"));
    const tsv = await fileToChatDocument(new File(["name\tvalue\na\t1"], "report.tsv"));

    expect(csv.mimeType).toBe("text/csv");
    expect(atob(csv.dataBase64)).toBe("name,value\na,1");
    expect(tsv.mimeType).toBe("text/tab-separated-values");
    expect(atob(tsv.dataBase64)).toBe("name\tvalue\na\t1");
  });

  test("rejects unsupported documents and more than two files", async () => {
    await expect(
      fileToChatDocument(new File(["{}"], "plan.json", { type: "application/json" })),
    ).rejects.toThrow("Markdown");
    const document = await fileToChatDocument(
      new File(["plan"], "plan.txt", { type: "text/plain" }),
    );
    expect(mergeChatDocuments([document, document], [document])).toBe("At most 2 documents");
  });
});
