import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { ChatMarkdown } = await import("./ChatMarkdown");

afterEach(cleanup);

const renderMarkdown = (content: string) => {
  render(<ChatMarkdown content={content} />);
  return screen.getByTestId("chat-markdown");
};

describe("angle brackets in prose", () => {
  test("shows <answer>, Array<string> and <your-token> as written", () => {
    const root = renderMarkdown(
      [
        'export const mascot = "<answer>";',
        "",
        'Reply with exactly "Saved: <answer>" and pass a `Map` of Array<string> using <your-token>.',
      ].join("\n"),
    );

    expect(root.textContent).toContain('export const mascot = "<answer>";');
    expect(root.textContent).toContain('"Saved: <answer>"');
    expect(root.textContent).toContain("Array<string>");
    expect(root.textContent).toContain("<your-token>");
    expect(root.querySelector("answer")).toBeNull();
  });

  test("keeps markdown working on the lines after a tag-looking line", () => {
    const root = renderMarkdown("<answer>\n\n- **first** item\n- second item");

    expect(root.textContent).toContain("<answer>");
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(root.querySelector("[data-streamdown=strong]")?.textContent).toBe("first");
  });

  test("shows closing and self-closing tags", () => {
    const root = renderMarkdown("Wrap it in <result>ok</result> or <br/> like that.");

    expect(root.textContent).toContain("<result>ok</result> or <br/> like that.");
    expect(root.querySelector("br")).toBeNull();
  });
});

describe("code keeps its brackets", () => {
  test("inline code", () => {
    const root = renderMarkdown("Call `useState<string>()` then `<answer>`.");

    const codes = [...root.querySelectorAll("code")].map((code) => code.textContent);
    expect(codes).toEqual(["useState<string>()", "<answer>"]);
  });

  test("fenced code block", async () => {
    const root = renderMarkdown('```ts\nconst xs: Array<string> = ["<answer>"];\n```');

    await waitFor(() => expect(root.querySelector("pre code")).toBeTruthy());
    expect(root.querySelector("pre code")?.textContent).toContain(
      'const xs: Array<string> = ["<answer>"];',
    );
  });
});

describe("untrusted HTML stays inert", () => {
  test("<script> renders as text and adds no element", () => {
    const root = renderMarkdown("Before <script>alert(1)</script> after");

    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
  });

  test("<img onerror> renders as text and adds no element", () => {
    const root = renderMarkdown("Look: <img src=x onerror=alert(1)>");

    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  test("block-level HTML and event handlers render as text", () => {
    const root = renderMarkdown(
      '<div onclick="alert(1)">click</div>\n\n<a href="javascript:alert(1)">x</a>',
    );

    expect(root.querySelector("div[onclick]")).toBeNull();
    expect(root.querySelector("[onclick]")).toBeNull();
    expect(root.querySelector('a[href^="javascript"]')).toBeNull();
    expect(root.textContent).toContain('<div onclick="alert(1)">click</div>');
  });

  test("markdown images and links with script URLs are not made live", () => {
    const root = renderMarkdown("[x](javascript:alert(1))");

    expect(root.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("real markdown still renders", () => {
  test("links, lists, tables and autolinks", () => {
    const root = renderMarkdown(
      [
        "See [docs](https://example.com/docs) and <https://example.com/auto>.",
        "",
        "1. one",
        "2. two",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    const hrefs = [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com/docs", "https://example.com/auto"]);
    expect(root.querySelectorAll("ol > li")).toHaveLength(2);
    expect(root.querySelectorAll("table tbody td")).toHaveLength(2);
  });
});

describe("single line breaks", () => {
  test("a newline inside a paragraph becomes a line break", () => {
    const root = renderMarkdown("First line\nSecond line\nThird line");

    expect(root.querySelectorAll("p")).toHaveLength(1);
    expect(root.querySelectorAll("p br")).toHaveLength(2);
    expect(root.querySelector("p")?.innerHTML).toMatch(
      /First line<br>\s*Second line<br>\s*Third line/,
    );
  });

  test("a blank line still starts a new paragraph, with no extra break", () => {
    const root = renderMarkdown("One\n\nTwo");

    expect(root.querySelectorAll("p")).toHaveLength(2);
    expect(root.querySelector("br")).toBeNull();
  });

  test("list items, nested lists and tables get no stray breaks", () => {
    const root = renderMarkdown(
      ["- one", "- two", "  - nested", "", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n"),
    );

    expect(root.querySelectorAll("li")).toHaveLength(3);
    expect(root.querySelectorAll("table tbody td")).toHaveLength(2);
    expect(root.querySelector("br")).toBeNull();
  });

  test("a wrapped list item keeps its breaks inside the item", () => {
    const root = renderMarkdown("1. first\n   continued\n2. second");

    expect(root.querySelectorAll("ol > li")).toHaveLength(2);
    expect(root.querySelector("ol > li")?.innerHTML).toMatch(/first<br>\s*continued/);
  });

  test("code blocks keep their newlines and gain no <br>", async () => {
    const root = renderMarkdown("Before\nafter\n\n```ts\nconst a = 1;\nconst b = 2;\n```");

    await waitFor(() => expect(root.querySelector("pre code")).toBeTruthy());
    expect(root.querySelector("pre br")).toBeNull();
    expect(root.querySelector("pre code")?.textContent).toContain("const a = 1;\nconst b = 2;");
    expect(root.querySelector("p")?.innerHTML).toMatch(/Before<br>\s*after/);
  });

  test("angle-bracket text survives across a line break", () => {
    const root = renderMarkdown("Use <your-token>\nthen Array<string>");

    expect(root.textContent).toContain("<your-token>");
    expect(root.textContent).toContain("Array<string>");
    expect(root.querySelector("p br")).toBeTruthy();
  });
});
