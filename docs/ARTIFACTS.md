# Artifacts

An artifact is a document an agent makes for the person, such as a plan, a JSON report, a diagram or a small HTML page. It is kept in the project's Library, shown as a card in the chat at the point where the agent made it, and opened in the artifact view, which takes the coordinator chat's place the way a pull request does. The chat stays mounted underneath it.

This page describes the design: the data model, how agents create artifacts, the rendering stack, the Visualize pipeline and the security rules for active content.

## Data model

An artifact is a Library item (`library_items`, `source = 'artifact'`) with versions. The Library owns the bytes. Its content-addressed blob store (`library/blobs/<sha256>`) holds every version, so an unchanged version costs nothing. Two additive tables hold what the Library has no place for:

| Table | Columns | Why |
| --- | --- | --- |
| `library_artifacts` | `item_id` (PK, FK `library_items` ON DELETE CASCADE), `title`, `kind`, `language`, `current_version`, `origin_message_id` | The title and type the card and the view show. `item_id` is the artifact's id everywhere: in turn parts, in routes and in the Library. |
| `library_artifact_versions` | `item_id`, `version` (1, 2, …), `sha256`, `size`, `mime_type`, `kind`, `note`, `session_id`, `message_id`, `created_at`; PK (`item_id`, `version`) | Every version, with the turn that wrote it. The item's own `sha256` and `size` follow the newest version, so the Library lists, serves and counts the current file without knowing about versions. |

`kind` is one of `markdown`, `json`, `code`, `csv`, `mermaid`, `html`, `svg`, `image`, `pdf` and `text`. It is inferred from the name and MIME type when the agent does not give one. The Library's file name keeps a matching extension (`release-plan.md`).

The Library's cleanup treats every `sha256` in `library_artifact_versions` as still used, so it never deletes an old version's blob while the artifact exists. Retention applies to the artifact as a whole: it keeps the Library's rules (30 days for what agents save, unless pinned), and a card whose artifact is gone shows "No longer in the Library".

A Library item that is not an artifact, such as an uploaded `.md` or a `.json` an agent saved with `aop_library_save`, opens in the same view as a single version. Files in a chat's workspace that a reply links to (`[plan](docs/plan.md)`, or an absolute path) open there too, read only, with a "Save to Library" action. They are read from that chat's workspace (a thread's worktree, or the coordinator's folder) under the same rules as an agent's save.

## How agents create artifacts

Two MCP tools, offered to the coordinator and to threads, sit beside the Library's `aop_library_save`/`list`/`read`:

- `aop_artifact_create {title, content | path, kind?, language?, name?, folder?}` creates the item and version 1.
- `aop_artifact_update {artifactId, content | path, note?}` adds a version. The title and kind stay unless they are given.

They validate like `aop_library_save`. Content and path are exclusive, a path must stay inside the caller's workspace, and the Library's size limit applies. Each `kind` is checked as well: JSON must parse, CSV must have a header row, Mermaid must start with its diagram type (no fence), SVG must hold an `<svg>` element, and images and PDFs must be the files they say. A refused call is an error the model reads, and no card is drawn. The result is plain text for the model, followed by one marker line, `aop-artifact: {"artifactId":…,"version":…,"title":…,"kind":…,"action":…}`.

`aop_artifact_update` also takes any Library file id: the file becomes an artifact, its content version 1.

**The card is a turn part.** `TurnPartSchema` gains an `artifact` part, `{type: "artifact", toolId, artifactId, version, title, kind, action: "created" | "updated"}`. The stream parser keeps the text of a tool result only for the AOP artifact tools. The turn accumulator turns its marker into an artifact part placed right after the tool call, which the chat then shows as the card instead of the tool row. Because it is an ordinary part, it streams live through the existing `start` op, persists in `chat_messages.parts`, and renders from history with no lookup. This works the same in the coordinator chat and in thread chats. Prose can also link an artifact as `[title](artifact:<id>)`, which renders as the same card inline, the same way `thread:` links render as chips.

## Where it opens

`openArtifactView({projectId, artifactId, version?})` follows the shape of the PR View's `openPullRequestView` (get-aop/aop#46):

- Routes: `/projects/:p[/threads/:t]/artifacts/:id[/:version]`, `…/files/:threadId|coordinator/:path` for a linked workspace file, and `…/visualize/:messageId` while a diagram is being drawn. `Route` gains `artifact?: ArtifactViewRef`, a sibling of `pullRequest`. They are exclusive: opening one replaces the other.
- The view takes the coordinator column under the breadcrumb **Coordinator › title** with ×, and Escape closes it. The chat stays mounted and hidden, keeping its scroll and draft. The threads panel stays as it is, so a card clicked in a thread chat opens the artifact in the coordinator column beside that thread.
- Toolbar: version switcher (`v3 of 3`, with "Compare with v2"), copy, download, open in Library, fullscreen, and a Raw/Rendered toggle where both make sense.

## Rendering stack

These were chosen for size: nothing loads until an artifact of that kind opens.

| Kind | How | Cost |
| --- | --- | --- |
| Markdown | Streamdown (already the chat's renderer): GFM tables, Shiki code blocks, and mermaid fences rendered as diagrams through a lazy Mermaid plugin | Mermaid 11 is already in the dependency tree (Streamdown's), and is imported on first diagram only, as a separate chunk |
| Code | `@streamdown/code` (Shiki, lazy), the same highlighter the chat uses | none new |
| JSON | Own tree component: fold and unfold, expand to depth, search with match count, copy a value or its path (`$.items[3].name`), and a raw toggle | about 200 lines, no dependency |
| CSV / TSV | Own RFC 4180 parser into a sticky-header table, capped at 5,000 rows with a note | no dependency |
| Mermaid | The same lazy Mermaid, with fit, zoom and copy-as-SVG | shared |
| Image / SVG | `<img>` from a `blob:` URL. SVG in `<img>` runs no script and loads nothing. | none |
| PDF | The browser's own viewer in an `<iframe>` (Chrome, Safari, and Electron with `plugins: true`). Download is the fallback. | none; no pdf.js (~1 MB) |
| HTML | Sandboxed `<iframe srcdoc>`; see Security | none |
| Version diff | Own line diff (Myers), side by side or unified, for text kinds | about 120 lines |

## Visualize

There is a **Visualize** button next to Copy under every finished assistant reply. It makes a diagram of that reply and shows it in the artifact view.

**What runs it:** a one-shot run of the coordinator's runtime (Claude Code) on the host, made to be small:

- `--model haiku --tools "" --strict-mcp-config --no-session-persistence`, with `MAX_THINKING_TOKENS=0`, and `--system-prompt` *replacing* Claude Code's default prompt. The last two make the difference. Measured on 2026-10-02 with Haiku 4.5 on a 90-word reply:

  | Setup | Input | Output | List cost | Time |
  | --- | --- | --- | --- | --- |
  | Default prompt, thinking on | 6,691 | 1,097 (882 thinking) | $0.0189 | 9.5 s |
  | Replaced prompt, thinking on | 526 | 3,913 (3,702 thinking) | $0.0201 | 25.7 s |
  | **Replaced prompt, thinking off** | **496** | **210** | **$0.0015** | **2.1 s** |

  On a Claude plan it counts toward usage like any other Haiku call. A long reply, around 2,000 words, is estimated at about $0.005 (not measured).
- The input is the reply's text only. It does not include the conversation, it never resumes a session, and the result is never added to the chat history. The coordinator does not see it unless the person shares it.
- The prompt asks for one diagram of a given type (`auto`, `flowchart`, `sequence`, `mindmap`, `timeline`, or `table`, which is a GFM table summary rather than Mermaid), with strict rules: quoted labels, ASCII ids, no styling, and at most 30 nodes.

**Where it runs.** The run uses the coordinator session's own Claude Code executable (a custom runtime's alias included, which is how the fake CLI stands in for it in tests), in an empty folder under the AOP home, and its log is deleted once read. The cost the panel shows is read from that log.

**Validate, repair and fall back.** The dashboard validates, because Mermaid needs a DOM to parse most diagram types, and the browser is where it renders anyway. Running it on the host would add a DOM shim and several MB to the `aop` binary.

1. The host generates a candidate and strips fences and prose around it.
2. The view runs `mermaid.parse`. If that fails, it asks the host for a repair with the parse error, which is one more call with the bad source and the error message.
3. If the repair also fails, the host builds a **structured outline** with no model call: the reply's headings, lists and sentences as a nested Markdown list. It is saved instead, marked as a fallback.

**Result and cache.** The outcome is saved as an artifact (`kind: mermaid`, or `markdown` for a table or an outline) in `Artifacts/Diagrams`, linked to the message (`origin_message_id`). Visualize on that message again opens it without a new call. **Regenerate** and **Different type** (a menu of the types) add a version, so earlier diagrams stay in the version switcher. The view shows progress while it works: "Reading the reply", then "Drawing", then "Checking the diagram", then "Repairing" when needed.

## Security

- **Bytes are never served as active content from the host's origin.** The artifact content route sends `Content-Security-Policy: sandbox; default-src 'none'`, `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for `html` and `svg`. Opening the URL directly then cannot run a script on the dashboard's origin, which holds the API session.
- **SVG** renders only through `<img>`, where scripts, event handlers and external loads do not run. It is never inlined into the DOM.
- **HTML** renders in `<iframe sandbox="allow-scripts" srcdoc=…>`. Without `allow-same-origin`, it gets an opaque origin: no cookies, no storage, no access to the parent and no AOP API. It also gets no forms, popups, top navigation, modals or downloads. A CSP is applied twice, through the iframe's `csp` attribute (Chromium and Electron) and a `<meta>` injected first in the document: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`. Together these block fetch, XHR, WebSocket, and external images, fonts and scripts. The one channel CSP cannot close is the frame navigating itself to a URL. The view counts the frame's loads, and on a second one it restores the document and says the page tried to leave. HTML opens rendered, and the toolbar's Raw shows its source.
- **Markdown** goes through Streamdown's sanitizer (rehype-harden), as chat replies do. Links open outside the app.
- **Mermaid** runs with `securityLevel: "strict"`, so labels cannot inject HTML or click handlers.
- **Workspace files** are read through the Library's `readAgentFile` rules: realpath inside the session's workspace, never `.git`, and the size limit.

### In the desktop app

The desktop app serves the dashboard under its own CSP (`apps/desktop/electron/app-protocol.ts`). Two changes let the view work there: `frame-src blob:` on the dashboard surface, so a PDF held in memory can be framed, and `plugins: true`, which turns on Chromium's built-in PDF viewer. A `srcdoc` frame inherits its parent's CSP, so in the desktop app an HTML artifact's own scripts do not run (`script-src 'self'`); the page renders as static HTML. The app's policy is not loosened for it.
