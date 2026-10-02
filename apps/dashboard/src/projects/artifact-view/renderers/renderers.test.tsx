import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../../../test/setup-dom";

setupDashboardDom();

// Mermaid needs a real browser; the view's own behaviour is what is tested here.
const rendered: string[] = [];
mock.module("../mermaid", () => ({
  renderMermaid: async (source: string) => {
    rendered.push(source);
    if (source.includes("broken")) throw new Error("Parse error on line 2");
    if (source.includes("empty")) return "";
    // Mermaid's labels are HTML (an open <br>), which an XML parser refuses.
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><p>diagram<br>label</p></div></foreignObject><script>alert(1)</script></svg>';
  },
  lazyMermaidPlugin: {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid: () => ({}),
  },
  checkMermaid: async () => ({ valid: true }),
  loadMermaid: async () => ({}),
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { JsonTree } = await import("./JsonTree");
const { CsvTable } = await import("./CsvTable");
const { HtmlFrame } = await import("./HtmlFrame");
const { DiffView } = await import("./DiffView");
const { MermaidView } = await import("./MermaidView");
const { ArtifactBody } = await import("./ArtifactBody");
const { HTML_ARTIFACT_CSP } = await import("./html-frame");

afterEach(cleanup);

const value = { release: "0.11", checks: { tests: { pass: 4849, fail: 0 } }, list: [1, 2] };

describe("JsonTree", () => {
  test("opens two levels, folds and unfolds, and searches with a count", () => {
    render(<JsonTree value={value} />);
    const paths = () =>
      screen.getAllByTestId("json-row").map((row) => row.getAttribute("data-path"));
    expect(paths()).toEqual([
      "$",
      "$.release",
      "$.checks",
      "$.checks.tests",
      "$.list",
      "$.list[0]",
      "$.list[1]",
    ]);

    fireEvent.change(screen.getByTestId("json-search"), { target: { value: "4849" } });
    expect(screen.getByTestId("json-search-count").textContent).toBe("1 match");
    expect(paths()).toContain("$.checks.tests.pass");
    const hit = screen.getAllByTestId("json-row").find((row) => row.getAttribute("data-match"));
    expect(hit?.getAttribute("data-path")).toBe("$.checks.tests.pass");

    fireEvent.click(screen.getByTestId("json-collapse-all"));
    expect(paths()).toEqual(["$", "$.release", "$.checks", "$.list"]);
    fireEvent.click(screen.getByTestId("json-expand-all"));
    expect(paths()).toContain("$.checks.tests.fail");
  });

  test("copies a value's path and the value itself", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    render(<JsonTree value={value} />);
    const row = screen
      .getAllByTestId("json-row")
      .find((r) => r.getAttribute("data-path") === "$.checks.tests");
    await act(async () => {
      fireEvent.click(row?.querySelector('[data-testid="json-copy-path"]') as Element);
      fireEvent.click(row?.querySelector('[data-testid="json-copy-value"]') as Element);
    });
    expect(copied).toEqual(["$.checks.tests", '{\n  "pass": 4849,\n  "fail": 0\n}']);
  });
});

describe("CsvTable", () => {
  test("draws a header, numbered rows and says how big it is", () => {
    render(<CsvTable text={'name,size\n"a, b",1\nc,2'} />);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "#",
      "name",
      "size",
    ]);
    expect(screen.getAllByRole("row")[1]?.textContent).toBe("1a, b1");
    expect(screen.getByTestId("artifact-csv-summary").textContent).toBe("2 rows · 2 columns");
  });
});

describe("HtmlFrame", () => {
  test("runs the page sandboxed: scripts only, an opaque origin, and the policy inside and on the frame", () => {
    render(<HtmlFrame html="<p>hi</p>" title="Page" />);
    const frame = screen.getByTestId("artifact-html-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("csp")).toBe(HTML_ARTIFACT_CSP);
    expect(frame.getAttribute("srcdoc")).toContain(`content="${HTML_ARTIFACT_CSP}"`);
    expect(frame.getAttribute("srcdoc")).toContain("<p>hi</p>");
  });

  test("a page that navigates itself away is put back and said so", () => {
    render(<HtmlFrame html="<p>hi</p>" title="Page" />);
    fireEvent.load(screen.getByTestId("artifact-html-frame"));
    expect(screen.queryByTestId("artifact-html-navigated")).toBeNull();
    fireEvent.load(screen.getByTestId("artifact-html-frame"));
    expect(screen.getByTestId("artifact-html-navigated")).toBeTruthy();
  });
});

describe("DiffView", () => {
  test("counts and marks what changed between two versions", () => {
    render(<DiffView before={"a\nb"} after={"a\nc"} beforeLabel="v1" afterLabel="v2" />);
    expect(screen.getByTestId("artifact-diff-summary").textContent).toContain("+1");
    const kinds = [...document.querySelectorAll("[data-diff]")].map((row) =>
      row.getAttribute("data-diff"),
    );
    expect(kinds).toEqual(["same", "removed", "added"]);
  });
});

describe("MermaidView", () => {
  test("draws the diagram as inert SVG nodes, and zooms", async () => {
    render(<MermaidView source="flowchart TD\nA-->B" />);
    await waitFor(() => expect(screen.getByTestId("artifact-mermaid")).toBeTruthy());
    await waitFor(() =>
      expect(document.querySelector(".artifact-mermaid-svg svg")?.textContent).toBe("diagramlabel"),
    );
    expect(document.querySelector(".artifact-mermaid-svg script")).toBeNull();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByTestId("mermaid-zoom-reset").textContent).toBe("125%");
  });

  test("a diagram that does not parse says why and shows its source", async () => {
    render(<MermaidView source="broken" />);
    await waitFor(() => expect(screen.getByTestId("artifact-mermaid-error")).toBeTruthy());
    expect(screen.getByTestId("artifact-mermaid-error").textContent).toContain(
      "Parse error on line 2",
    );
  });

  test("a diagram Mermaid drew nothing for says so instead of an empty view", async () => {
    render(<MermaidView source="empty" />);
    await waitFor(() => expect(screen.getByTestId("artifact-mermaid-error")).toBeTruthy());
    expect(screen.getByTestId("artifact-mermaid-error").textContent).toContain(
      "Mermaid returned no SVG.",
    );
    expect(screen.queryByTestId("artifact-mermaid")).toBeNull();
  });
});

describe("ArtifactBody", () => {
  const content = (
    kind: Parameters<typeof ArtifactBody>[0]["content"]["kind"],
    text: string | null,
    mimeType = "text/plain",
  ) => ({
    kind,
    blob: new Blob([text ?? "x"], { type: mimeType }),
    mimeType,
    text,
    language: kind === "code" ? "typescript" : null,
    title: "T",
  });

  test("draws each kind as itself", async () => {
    const cases: [Parameters<typeof content>[0], string | null, string, string?][] = [
      ["json", '{"a":1}', "artifact-json"],
      ["csv", "a,b\n1,2", "artifact-csv"],
      ["html", "<p>x</p>", "artifact-html"],
      ["text", "plain", "artifact-text"],
      ["markdown", "# Title", "artifact-markdown"],
      ["code", "const a = 1;", "artifact-code"],
      ["image", null, "artifact-image", "image/png"],
      ["svg", "<svg/>", "artifact-svg", "image/svg+xml"],
      ["pdf", null, "artifact-pdf", "application/pdf"],
    ];
    for (const [kind, text, testId, mimeType] of cases) {
      const { unmount } = render(
        <ArtifactBody content={content(kind, text, mimeType)} raw={false} />,
      );
      await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy());
      unmount();
    }
  });

  test("JSON that does not parse shows its text; Source shows any text kind as code", () => {
    const { unmount } = render(<ArtifactBody content={content("json", "{oops")} raw={false} />);
    expect(screen.getByTestId("artifact-text").textContent).toBe("{oops");
    unmount();
    render(<ArtifactBody content={content("csv", "a,b")} raw />);
    expect(screen.getByTestId("artifact-code")).toBeTruthy();
  });
});
