import { describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../../test/setup-dom";
import { parseMermaidSvg } from "./mermaid-svg";

setupDashboardDom();

// What Mermaid 11 writes for a flowchart label with a line break: HTML, not XML. Chromium's XML
// parser stops at the `<br>` ("Opening and ending tag mismatch: br and p"). Mermaid's <style> is
// left out, and the script below comes last: happy-dom's parser drops a <style> or <script> inside
// an SVG and what follows it, which browsers do not.
const FLOWCHART = [
  '<svg id="m1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">',
  '<g class="node"><rect width="120" height="40"></rect>',
  '<foreignObject width="120" height="40"><div xmlns="http://www.w3.org/1999/xhtml">',
  '<span class="nodeLabel"><p>Build<br>and&nbsp;test</p></span></div></foreignObject></g>',
  "</svg>",
].join("");

describe("parseMermaidSvg", () => {
  test("reads Mermaid's HTML-serialized labels that an XML parser refuses", () => {
    const svg = parseMermaidSvg(FLOWCHART);
    expect(svg.localName).toBe("svg");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 300 120");
    expect(svg.querySelector("p")?.textContent).toBe("Buildand\u00a0test");
    expect(svg.querySelectorAll("br").length).toBe(1);
  });

  test("drops scripts, event handlers and javascript: links", () => {
    const svg = parseMermaidSvg(
      '<svg onload="alert(1)" viewBox="0 0 10 10">' +
        '<a href="javascript:alert(3)"><text onclick="alert(4)">x</text></a>' +
        '<a href="https://example.com"><text>y</text></a><script>alert(2)</script></svg>',
    );
    expect(svg.hasAttribute("onload")).toBe(false);
    expect(svg.querySelector("script")).toBeNull();
    expect(svg.querySelector("text")?.hasAttribute("onclick")).toBe(false);
    const links = [...svg.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([null, "https://example.com"]);
  });

  test("says so when Mermaid gave no SVG", () => {
    expect(() => parseMermaidSvg("")).toThrow("Mermaid returned no SVG.");
    expect(() => parseMermaidSvg("<p>not a diagram</p>")).toThrow("Mermaid returned no SVG.");
  });
});
