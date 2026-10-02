/**
 * Mermaid's SVG markup as an element the view can attach. Mermaid writes it with the HTML
 * serializer, so its labels hold HTML that is not XML (a `<br>` with no end tag): read as
 * `image/svg+xml`, Chromium wraps the whole document in an error page and nothing is drawn. The
 * HTML parser reads it the way a page reads inline SVG. Mermaid's strict level already leaves out
 * scripts and handlers; they are dropped here too, because copied nodes are live once attached.
 */
export const parseMermaidSvg = (markup: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(markup, "text/html").querySelector("svg");
  if (!svg) throw new Error("Mermaid returned no SVG.");
  for (const script of svg.querySelectorAll("script")) script.remove();
  for (const element of [svg, ...svg.querySelectorAll("*")]) dropActiveAttributes(element);
  return svg;
};

const dropActiveAttributes = (element: Element) => {
  for (const { name, value } of [...element.attributes]) {
    const handler = name.toLowerCase().startsWith("on");
    const scriptLink = /href$/i.test(name) && /^\s*javascript:/i.test(value);
    if (handler || scriptLink) element.removeAttribute(name);
  }
};
