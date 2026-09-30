interface MarkdownProcessor {
  data(): object;
}

// Chat text is prose, not HTML. Claude writes `Array<string>`, `<your-token>`
// and XML-ish tags all the time, and the default pipeline parses those as HTML
// and then sanitizes them away. Switching off the two HTML constructs in the
// markdown parser leaves the angle brackets as ordinary text (autolinks such as
// <https://x.dev> and code spans/blocks are separate constructs and still work),
// and no raw HTML node is ever produced, so nothing can be injected.
export function remarkLiteralHtml(this: MarkdownProcessor): void {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  data.micromarkExtensions = [
    ...(data.micromarkExtensions ?? []),
    { disable: { null: ["htmlFlow", "htmlText"] } },
  ];
}
