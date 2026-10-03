import { describe, expect, test } from "bun:test";
import { adfToMarkdown, jiraTextToMarkdown } from "./adf-markdown.ts";

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const item = (...content: unknown[]) => ({ type: "listItem", content });

describe("adfToMarkdown blocks", () => {
  test("renders headings with clamped levels and paragraphs separated by a blank line", () => {
    const markdown = adfToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
        { type: "heading", attrs: { level: 9 }, content: [text("Deep")] },
        { type: "heading", attrs: { level: "x" }, content: [text("Odd")] },
        paragraph(text("Body")),
      ),
    );
    expect(markdown).toBe("## Steps\n\n###### Deep\n\n# Odd\n\nBody");
  });

  test("indents a bullet list nested in an ordered list under the item's text", () => {
    const markdown = adfToMarkdown(
      doc({
        type: "orderedList",
        attrs: { order: 3 },
        content: [
          item(paragraph(text("First")), {
            type: "bulletList",
            content: [item(paragraph(text("Inner")))],
          }),
          item(paragraph(text("Second"))),
        ],
      }),
    );
    expect(markdown).toBe("3. First\n   - Inner\n4. Second");
  });

  test("renders task items with their state and nested task lists indented", () => {
    const markdown = adfToMarkdown(
      doc({
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { state: "DONE" }, content: [text("Ship")] },
          {
            type: "taskList",
            content: [{ type: "taskItem", attrs: { state: "TODO" }, content: [text("Sub")] }],
          },
          { type: "taskItem", attrs: { state: "TODO" }, content: [text("Test")] },
        ],
      }),
    );
    expect(markdown).toBe("- [x] Ship\n  - [ ] Sub\n- [ ] Test");
  });

  test("renders decision items like list items", () => {
    const markdown = adfToMarkdown(
      doc({
        type: "decisionList",
        content: [
          { type: "decisionItem", attrs: { state: "DECIDED" }, content: [text("Use Bun")] },
        ],
      }),
    );
    expect(markdown).toBe("- Use Bun");
  });

  test("fences a code block longer than any backtick run inside it, without escaping", () => {
    const markdown = adfToMarkdown(
      doc({
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [text("const a = `x`;\n```\n*raw*")],
      }),
    );
    expect(markdown).toBe("````ts\nconst a = `x`;\n```\n*raw*\n````");
  });

  test("drops an unsafe code block language", () => {
    expect(
      adfToMarkdown(doc({ type: "codeBlock", attrs: { language: "a b`" }, content: [text("x")] })),
    ).toBe("```\nx\n```");
  });

  test("renders a blockquote, a rule and a labelled panel", () => {
    const markdown = adfToMarkdown(
      doc(
        { type: "blockquote", content: [paragraph(text("Quoted")), paragraph(text("Again"))] },
        { type: "rule" },
        { type: "panel", attrs: { panelType: "warning" }, content: [paragraph(text("Careful"))] },
      ),
    );
    expect(markdown).toBe("> Quoted\n>\n> Again\n\n---\n\n> **Warning:**\n> Careful");
  });

  test("renders a table whose first row holds header cells", () => {
    const cell = (type: string, value: string) => ({ type, content: [paragraph(text(value))] });
    const markdown = adfToMarkdown(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "Name"), cell("tableHeader", "Note")] },
          {
            type: "tableRow",
            content: [
              cell("tableCell", "a|b"),
              { type: "tableCell", content: [paragraph(text("one")), paragraph(text("two"))] },
            ],
          },
        ],
      }),
    );
    expect(markdown).toBe("| Name | Note |\n| --- | --- |\n| a\\|b | one two |");
  });

  test("inserts an empty header row when the table has none, and escapes pipes in code", () => {
    const markdown = adfToMarkdown(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [paragraph(text("x|y", [{ type: "code" }]))] }],
          },
        ],
      }),
    );
    expect(markdown).toBe("|  |\n| --- |\n| `x\\|y` |");
  });

  test("renders media as an attachment label", () => {
    const markdown = adfToMarkdown(
      doc(
        {
          type: "mediaSingle",
          content: [{ type: "media", attrs: { alt: "screen.png", id: "1" } }],
        },
        { type: "mediaGroup", content: [{ type: "media", attrs: { id: "2" } }] },
      ),
    );
    expect(markdown).toBe("\\[attachment: screen.png\\]\n\n\\[attachment\\]");
  });

  test("renders an expand title in bold followed by its content", () => {
    const markdown = adfToMarkdown(
      doc({ type: "expand", attrs: { title: "Details" }, content: [paragraph(text("Hidden"))] }),
    );
    expect(markdown).toBe("**Details**\n\nHidden");
  });

  test("renders only http(s) block cards as links", () => {
    const markdown = adfToMarkdown(
      doc(
        { type: "blockCard", attrs: { url: "https://example.com/a b" } },
        { type: "embedCard", attrs: { url: "javascript:alert(1)" } },
      ),
    );
    expect(markdown).toBe("<https://example.com/a%20b>");
  });
});

describe("adfToMarkdown inline", () => {
  test("combines strong and em marks around the text, leaving its spaces outside", () => {
    const markdown = adfToMarkdown(
      doc(
        paragraph(
          text("a"),
          text(" both ", [{ type: "strong" }, { type: "em" }]),
          text("z", [{ type: "strike" }]),
        ),
      ),
    );
    expect(markdown).toBe("a **_both_** ~~z~~");
  });

  test("keeps safe links and drops javascript: hrefs to plain text", () => {
    const link = (href: string) => [{ type: "link", attrs: { href } }];
    const markdown = adfToMarkdown(
      doc(
        paragraph(text("good", link("https://example.com/x(1)"))),
        paragraph(text("bad", link("javascript:alert(1)"))),
        paragraph(text("mail", link("mailto:a@b.c"))),
      ),
    );
    expect(markdown).toBe("[good](https://example.com/x%281%29)\n\nbad\n\n[mail](mailto:a@b.c)");
  });

  test("renders a code mark without escaping, with a fence longer than its backticks", () => {
    expect(adfToMarkdown(doc(paragraph(text("a*`b`", [{ type: "code" }]))))).toBe("`` a*`b` ``");
    expect(adfToMarkdown(doc(paragraph(text("<b>", [{ type: "code" }]))))).toBe("`<b>`");
  });

  test("renders mentions, emoji, status, dates, inline cards and hard breaks", () => {
    const markdown = adfToMarkdown(
      doc(
        paragraph(
          { type: "mention", attrs: { id: "1", text: "@Jane Doe" } },
          text(" "),
          { type: "emoji", attrs: { shortName: ":smile:", text: "😄" } },
          text(" "),
          { type: "emoji", attrs: { shortName: ":tada:" } },
          { type: "hardBreak" },
          { type: "status", attrs: { text: "IN PROGRESS", color: "blue" } },
          text(" "),
          { type: "date", attrs: { timestamp: "1700000000000" } },
          text(" "),
          { type: "inlineCard", attrs: { url: "https://jira.example.com/browse/X-1" } },
          { type: "placeholder", attrs: { text: "Type here" } },
        ),
      ),
    );
    expect(markdown).toBe(
      "@Jane Doe 😄 :tada:\\\n`IN PROGRESS` 2023-11-14 <https://jira.example.com/browse/X-1>",
    );
  });

  test("drops hard breaks at the edges of a paragraph", () => {
    expect(
      adfToMarkdown(doc(paragraph({ type: "hardBreak" }, text("x"), { type: "hardBreak" }))),
    ).toBe("x");
  });

  test("escapes text so it cannot form emphasis, links, HTML or block markers", () => {
    const markdown = adfToMarkdown(
      doc(
        paragraph(text("*not bold* [x](y) <script>alert(1)</script> a_b ~c~ | &amp;")),
        paragraph(text("# not heading")),
        paragraph(text("1. not list")),
        paragraph(text("- not bullet")),
      ),
    );
    expect(markdown).toBe(
      "\\*not bold\\* \\[x\\](y) \\<script\\>alert(1)\\</script\\> a\\_b \\~c\\~ \\| \\&amp;\n\n\\# not heading\n\n1\\. not list\n\n\\- not bullet",
    );
  });
});

describe("adfToMarkdown malformed input", () => {
  test("returns an empty string for values that are not documents", () => {
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
    expect(adfToMarkdown(42)).toBe("");
    expect(adfToMarkdown([])).toBe("");
    expect(adfToMarkdown({})).toBe("");
    expect(adfToMarkdown({ type: "doc", content: "x" })).toBe("");
  });

  test("renders a string input as escaped plain text", () => {
    expect(adfToMarkdown("*hi*")).toBe("\\*hi\\*");
  });

  test("renders the text of unknown block and inline nodes", () => {
    const markdown = adfToMarkdown(
      doc(
        {
          type: "futureBlock",
          content: [paragraph(text("inside"), { type: "futureInline", attrs: { text: "*t*" } })],
        },
        { type: "toString", content: [text("proto")] },
        { type: "panel", attrs: { panelType: "constructor" }, content: [paragraph(text("plain"))] },
        { type: 7, text: "loose" },
      ),
    );
    expect(markdown).toBe("inside\\*t\\*\n\nproto\n\n> plain\n\nloose");
  });

  test("ignores children and marks of the wrong type", () => {
    const markdown = adfToMarkdown(
      doc(
        null,
        "x",
        paragraph(text("ok", [null, "strong", { type: 1 }, { type: "strong", attrs: "x" }]), 5),
      ),
    );
    expect(markdown).toBe("**ok**");
  });

  test("does not throw on 1000 levels of nesting", () => {
    let node: unknown = text("leaf");
    for (let level = 0; level < 1000; level++) node = { type: "blockquote", content: [node] };
    const markdown = adfToMarkdown(doc(node));
    expect(typeof markdown).toBe("string");
    expect(markdown).not.toContain("leaf");
  });

  test("renders an invalid date as nothing", () => {
    expect(
      adfToMarkdown(doc(paragraph(text("on "), { type: "date", attrs: { timestamp: "soon" } }))),
    ).toBe("on");
  });
});

describe("jiraTextToMarkdown", () => {
  test("escapes markdown and keeps line breaks and paragraphs", () => {
    expect(jiraTextToMarkdown("h1. Title\r\n*bold* <b>\n# item\n\n\n\n_x_ [link|http://a]")).toBe(
      "h1. Title\\\n\\*bold\\* \\<b\\>\\\n\\# item\n\n\\_x\\_ \\[link\\|http://a\\]",
    );
  });

  test("returns an empty string for blank or non-string input", () => {
    expect(jiraTextToMarkdown("  \n \n")).toBe("");
    expect(jiraTextToMarkdown(null as unknown as string)).toBe("");
  });
});
