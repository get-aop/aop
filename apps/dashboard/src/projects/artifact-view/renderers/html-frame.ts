/**
 * The policy an HTML artifact runs under: its own inline script and style, images and fonts only
 * from data and blob URLs, and no network at all (no fetch, XHR, WebSocket, external script,
 * image, font, frame or form target).
 */
export const HTML_ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

/**
 * The iframe's sandbox: scripts may run, but without `allow-same-origin` the page gets an opaque
 * origin (no cookies, storage, parent or AOP API), and nothing else is allowed: no forms,
 * popups, top navigation, modals or downloads.
 */
export const HTML_ARTIFACT_SANDBOX = "allow-scripts";

/**
 * The document the iframe loads: the artifact's HTML with the policy as the first thing in its
 * head, so it applies before any of the page's own markup is read. A fragment gets a document of
 * its own around it.
 */
export const htmlArtifactDocument = (html: string): string => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_CSP}">`;
  const base = '<base target="_self">';
  if (/<head[\s>]/i.test(html))
    return html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${meta}${base}`);
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (open) => `${open}<head>${meta}${base}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${meta}${base}<style>body{font-family:system-ui,sans-serif;margin:16px}</style></head><body>${html}</body></html>`;
};
