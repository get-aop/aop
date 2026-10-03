/**
 * Atlassian Document Format bodies for the fake Jira site: issue descriptions, the
 * "Acceptance criteria" custom field and comments. Between them they use every node the Issues
 * tab has to render or flatten (headings, marks, mentions, emoji, lists nested and checked, code,
 * panels, tables, media, smart links, hard breaks), shaped the way Jira Cloud returns them.
 */
import { PEOPLE, type Person } from "./jira-people.ts";

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  version?: number;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export type Inline = AdfNode | string;

// Builders: a bare string is plain text, so bodies read close to what a person typed.
const text = (value: string, ...marks: AdfMark[]): AdfNode =>
  marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value };
const inline = (parts: Inline[]): AdfNode[] =>
  parts.map((part) => (typeof part === "string" ? text(part) : part));

export const strong = (value: string) => text(value, { type: "strong" });
export const em = (value: string) => text(value, { type: "em" });
export const code = (value: string) => text(value, { type: "code" });
export const link = (value: string, href: string) => text(value, { type: "link", attrs: { href } });
export const mention = (who: Person): AdfNode => ({
  type: "mention",
  attrs: { id: who.accountId, text: `@${who.displayName}`, accessLevel: "" },
});
export const emoji = (shortName: string, id: string, glyph: string): AdfNode => ({
  type: "emoji",
  attrs: { shortName, id, text: glyph },
});
export const hardBreak: AdfNode = { type: "hardBreak" };
export const inlineCard = (url: string): AdfNode => ({ type: "inlineCard", attrs: { url } });

export const doc = (...content: AdfNode[]): AdfNode => ({ type: "doc", version: 1, content });
export const p = (...parts: Inline[]): AdfNode => ({ type: "paragraph", content: inline(parts) });
export const h = (level: number, value: string): AdfNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
// A list entry is one inline, a run of inlines (one paragraph), or blocks (a paragraph and a
// nested list).
type Entry = Inline | Inline[];
const isBlock = (part: Inline) => typeof part !== "string" && part.type !== "text" && part.content;
const item = (entry: Entry): AdfNode => {
  const parts = Array.isArray(entry) ? entry : [entry];
  const blocks = parts.every(isBlock) ? (parts as AdfNode[]) : [p(...parts)];
  return { type: "listItem", content: blocks };
};
export const bullets = (...entries: Entry[]): AdfNode => ({
  type: "bulletList",
  content: entries.map(item),
});
export const numbered = (...entries: Entry[]): AdfNode => ({
  type: "orderedList",
  attrs: { order: 1 },
  content: entries.map(item),
});
export const tasks = (...entries: [done: boolean, label: string][]): AdfNode => ({
  type: "taskList",
  attrs: { localId: crypto.randomUUID() },
  content: entries.map(([done, label]) => ({
    type: "taskItem",
    attrs: { localId: crypto.randomUUID(), state: done ? "DONE" : "TODO" },
    content: [text(label)],
  })),
});
export const codeBlock = (language: string, source: string): AdfNode => ({
  type: "codeBlock",
  attrs: { language },
  content: [text(source)],
});
export const panel = (panelType: string, ...content: AdfNode[]): AdfNode => ({
  type: "panel",
  attrs: { panelType },
  content,
});
const cell = (type: string, value: string): AdfNode => ({
  type,
  attrs: {},
  content: [p(value)],
});
export const table = (header: string[], ...rows: string[][]): AdfNode => ({
  type: "table",
  attrs: { isNumberColumnEnabled: false, layout: "default", localId: crypto.randomUUID() },
  content: [
    { type: "tableRow", content: header.map((value) => cell("tableHeader", value)) },
    ...rows.map((row) => ({
      type: "tableRow",
      content: row.map((value) => cell("tableCell", value)),
    })),
  ],
});
export const image = (alt: string, width: number, height: number): AdfNode => ({
  type: "mediaSingle",
  attrs: { layout: "center", width: 50, widthType: "percentage" },
  content: [
    {
      type: "media",
      attrs: {
        id: crypto.randomUUID(),
        type: "file",
        collection: "contentId-10342",
        width,
        height,
        alt,
      },
    },
  ],
});

const { sam, priya, marcus, lena, devon, tomas } = PEOPLE;

/** APP-1: the kitchen-sink description. */
const loginFreeze = doc(
  h(2, "Summary"),
  p(
    "On iOS 18.1 the ",
    strong("login screen"),
    " stops responding after the ",
    em("Face ID"),
    " sheet is dismissed with ",
    code("Cancel"),
    ". Reported by ",
    mention(priya),
    " during the 2.4 beta ",
    emoji(":warning:", "26a0", "⚠️"),
  ),
  h(3, "Steps to reproduce"),
  numbered(
    "Sign out, then open the app",
    ["Tap ", strong("Sign in with Face ID")],
    [
      p("Dismiss the system sheet:"),
      bullets("with the Cancel button", ["by swiping down ", em("(sometimes)")]),
    ],
  ),
  p("Expected: the password field takes focus.", hardBreak, "Actual: nothing is tappable."),
  h(3, "Notes"),
  bullets(
    ["Crash-free, the main thread is ", strong("not"), " blocked"],
    ["Same as ", inlineCard("https://github.com/acme/mobile/issues/812")],
  ),
  codeBlock(
    "swift",
    "context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in\n    guard ok else { return } // the sheet is gone, but focus never returns\n    self.signIn()\n}",
  ),
  panel(
    "info",
    p("Android is not affected; see ", link("the beta notes", "https://example.com/beta/2.4"), "."),
  ),
  table(
    ["Device", "OS", "Reproduces"],
    ["iPhone 15", "18.1", "Always"],
    ["iPhone 12 mini", "17.6", "No"],
  ),
  image("login-freeze.png", 1170, 2532),
  h(3, "Checklist"),
  tasks([true, "Reproduce on a clean install"], [false, "Add a UI test for the cancel path"]),
);

/** APP-3: acceptance criteria written into the description itself. */
const wrongScreen = doc(
  p(
    "Tapping a ",
    strong("new reply"),
    " notification on Android 15 opens the inbox instead of the thread.",
  ),
  h(2, "Acceptance criteria"),
  bullets(
    "A reply notification opens that thread, scrolled to the reply",
    "A mention notification opens the post with the mention highlighted",
    ["Works from a cold start and with the app in the ", em("background")],
  ),
  p(
    "Related: ",
    inlineCard("https://developer.android.com/develop/ui/views/notifications/navigation"),
  ),
);

/** APP-2: the description says what; customfield_10050 holds the acceptance criteria. */
const offlineMode = doc(
  p("Readers on the train lose their saved articles when the connection drops."),
  p("Cache the last ", strong("50"), " saved articles with images, oldest evicted first."),
);
export const OFFLINE_ACCEPTANCE = doc(
  bullets(
    "Saved articles open with no connection",
    ["The ", strong("Saved"), " tab shows when each was last synced"],
    "Removing an article from Saved deletes its cached copy",
  ),
);

export const DESCRIPTIONS: Record<string, AdfNode | null> = {
  "APP-1": loginFreeze,
  "APP-2": offlineMode,
  "APP-3": wrongScreen,
  "APP-4": null,
  "APP-5": doc(
    p("The toggles on Settings are ", code("#9AA0A6"), " on ", code("#FFFFFF"), ": 2.6:1."),
    p("Needs at least 3:1 for UI components (WCAG 1.4.11)."),
  ),
  "APP-6": doc(
    p("Upload dSYMs and ProGuard maps from the release lane so crashes show source lines."),
    codeBlock("bash", "bundle exec fastlane upload_symbols version:2.4.0"),
  ),
  "APP-7": doc(p("Marketing wants a final pass on the four onboarding slides.")),
  "APP-8": doc(
    p("Links in the October campaign email should open the matching screen in the app."),
    bullets(
      ["Article links: ", code("acme://article/{id}")],
      ["Offer links: ", code("acme://offers/{slug}")],
    ),
  ),
  "OPS-1": doc(
    panel("warning", p("Do this before the 2.4 load test on Monday.")),
    numbered("Create the new role in Vault", "Roll the API pods", "Revoke the old role"),
  ),
  "OPS-2": doc(
    p("The ", code("pg-nightly"), " job now takes 5h40m against a 4h window."),
    table(["Date", "Duration"], ["2026-09-27", "5h12m"], ["2026-09-28", "5h40m"]),
  ),
  "OPS-3": doc(
    h(2, "Why"),
    p("arm64 runners cost about 40% less for the same build times."),
    h(2, "Plan"),
    tasks(
      [true, "Benchmark the mobile build"],
      [false, "Move the web build"],
      [false, "Retire the x86 pool"],
    ),
  ),
  "OPS-4": doc(p("Page the on-call when any public certificate expires within 14 days.")),
  "OPS-5": doc(p("Application logs are kept for 90 days; policy says 30.")),
  "OPS-6": doc(
    h(2, "Timeline"),
    p(
      "14:02 UTC p95 latency crossed 2s.",
      hardBreak,
      "14:19 UTC rolled back release 2026.09.19-2.",
    ),
    h(2, "Follow-ups"),
    bullets(["Load test the new ORM version ", emoji(":repeat:", "1f501", "🔁")]),
  ),
};

export interface FixtureComment {
  author: Person;
  body: AdfNode;
  /** Minutes before the issue's last update. */
  minutesBefore: number;
}

const comment = (author: Person, minutesBefore: number, ...content: AdfNode[]): FixtureComment => ({
  author,
  body: doc(...content),
  minutesBefore,
});

export const COMMENTS: Record<string, FixtureComment[]> = {
  "APP-1": [
    comment(priya, 600, p("Still happens on 18.1 beta 4. Screen recording attached in Slack.")),
    comment(
      marcus,
      240,
      p(mention(sam), " could this be the focus guard from ", code("LoginView"), "?"),
    ),
    comment(
      sam,
      30,
      p("Yes. The guard waits for a callback that never fires on cancel. Fix is up for review."),
    ),
  ],
  "APP-2": [
    comment(lena, 900, p("Do we cache images at full size or the list thumbnails?")),
    comment(
      tomas,
      120,
      p("Full size, readers open the article offline ", emoji(":slight_smile:", "1f642", "🙂")),
    ),
  ],
  "APP-3": [
    comment(
      marcus,
      60,
      p("PR is in review: the intent was missing ", code("FLAG_ACTIVITY_NEW_TASK"), "."),
    ),
    comment(devon, 15, p("Tested on a Pixel 9, cold start works now.")),
  ],
  "OPS-2": [
    comment(
      marcus,
      300,
      p("The dump is fine; the upload to the archive bucket is what got slower."),
    ),
    comment(priya, 200, bullets("Try parallel multipart upload", "Or move the window to 01:00")),
    comment(sam, 45, p("Going with multipart, ", strong("8 parts"), ".")),
  ],
  "OPS-6": [comment(lena, 400, p("Draft is in Confluence, please review by Friday."))],
};
