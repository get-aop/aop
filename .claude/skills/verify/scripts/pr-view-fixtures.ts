/**
 * The pull requests the fake `gh` of the PR View recipe answers for (`fake-gh-pr-view.ts`), one
 * per state the page has to show. All live in the repository `acme/fixtures`.
 *
 *   #1 ready      open, clean, required check green, approved, labels, assignee, milestone,
 *                 linked issue, a review conversation, and files: a normal one, a large one
 *                 (1,400 lines, behind "Load diff"), a binary one, a rename
 *   #2 blocked    open, by someone else: required check failing, another required check never
 *                 reported, changes requested, conflicts, behind, an unresolved conversation the
 *                 rules want resolved, and an optional check failing
 *   #3 draft      a draft whose checks are still running (the page polls them)
 *   #4 merged     merged and closed
 *   #5 closed     closed without merging
 *   #6 huge       320 files (all start folded) and one 20,000-line file (virtualized)
 *   #7 empty      no checks, no files, no description
 *   #8 read-only  the host's account may only read the repository
 *   #9 behind     approved and green, but behind a base that wants branches up to date
 */

export interface FixtureFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  previous_filename?: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface FixtureCheck {
  name: string;
  status: "COMPLETED" | "IN_PROGRESS" | "QUEUED";
  conclusion: string | null;
  isRequired: boolean;
}

export interface FixturePullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: string;
  reviewDecision: string | null;
  viewerPermission: string;
  checks: FixtureCheck[];
  labels: { name: string; color: string }[];
  assignees: string[];
  milestone: string | null;
  linkedIssues: { number: number; title: string; state: "OPEN" | "CLOSED" }[];
  reviews: { author: string; state: string; body: string; at: string }[];
  reviewRequests: string[];
  comments: { author: string; body: string; at: string }[];
  events: { type: string; actor: string; at: string; extra?: Record<string, unknown> }[];
  threads: {
    path: string;
    line: number;
    resolved: boolean;
    comments: { author: string; body: string }[];
  }[];
  commits: { oid: string; headline: string; at: string; author: string; rollup: string | null }[];
  files: FixtureFile[];
  /** Rules on the base branch (`rules/branches/main`). */
  rules: unknown[];
}

const AT = "2026-10-01T10:00:00Z";
const sha = (seed: string) => seed.repeat(40).slice(0, 40);

const lines = (count: number, make: (n: number) => string) =>
  Array.from({ length: count }, (_, index) => make(index + 1)).join("\n");

const smallPatch = `@@ -1,6 +1,8 @@
 import { checkout } from "./checkout";
-import { slowTotal } from "./totals";
+import { fastTotal } from "./totals";
+import { cache } from "./cache";

 export const pay = (cart: Cart) => {
-  return checkout(cart, slowTotal(cart));
+  const total = cache(cart.id, () => fastTotal(cart));
+  return checkout(cart, total);
 };`;

const addedPatch = (count: number) =>
  `@@ -0,0 +1,${count} @@\n${lines(count, (n) => `+export const value${n} = ${n} * 2; // generated line ${n}`)}`;

const STANDARD_RULES = [
  {
    type: "pull_request",
    parameters: {
      required_approving_review_count: 1,
      required_review_thread_resolution: true,
      allowed_merge_methods: ["merge", "squash", "rebase"],
    },
  },
  { type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }] } },
];

const base = (number: number, overrides: Partial<FixturePullRequest>): FixturePullRequest => ({
  number,
  title: `Fixture pull request ${number}`,
  body: "",
  author: "fixture-owner",
  state: "OPEN",
  isDraft: false,
  headRefName: `feature/${number}`,
  headRefOid: sha(String(number)),
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  viewerPermission: "ADMIN",
  checks: [],
  labels: [],
  assignees: [],
  milestone: null,
  linkedIssues: [],
  reviews: [],
  reviewRequests: [],
  comments: [],
  events: [],
  threads: [],
  commits: [
    {
      oid: sha(String(number)),
      headline: `Work for #${number}`,
      at: AT,
      author: "fixture-owner",
      rollup: null,
    },
  ],
  files: [],
  rules: STANDARD_RULES,
  ...overrides,
});

export const fixturePullRequests = (): FixturePullRequest[] => [
  base(1, {
    title: "Make checkout fast with a cached total",
    author: "ada",
    body: "## Why\n\nCheckout recomputed the total on **every** render. This caches it per cart.\n\n- adds `cache()`\n- swaps `slowTotal` for `fastTotal`\n\nCloses #12.",
    reviewDecision: "APPROVED",
    checks: [
      { name: "test", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true },
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS", isRequired: false },
      { name: "e2e", status: "COMPLETED", conclusion: "SKIPPED", isRequired: false },
    ],
    labels: [
      { name: "performance", color: "a2eeef" },
      { name: "checkout", color: "d876e3" },
    ],
    assignees: ["ada"],
    milestone: "v1.2",
    linkedIssues: [{ number: 12, title: "Checkout is slow on big carts", state: "OPEN" }],
    reviews: [
      {
        author: "bob",
        state: "APPROVED",
        body: "Nice, much faster here.",
        at: "2026-10-01T12:00:00Z",
      },
    ],
    reviewRequests: ["carol"],
    comments: [
      {
        author: "carol",
        body: "Does the cache clear when the cart changes?",
        at: "2026-10-01T11:00:00Z",
      },
    ],
    events: [
      {
        type: "LabeledEvent",
        actor: "ada",
        at: "2026-10-01T10:30:00Z",
        extra: { label: { name: "performance", color: "a2eeef" } },
      },
      {
        type: "ReviewRequestedEvent",
        actor: "ada",
        at: "2026-10-01T10:31:00Z",
        extra: { requestedReviewer: { __typename: "User", login: "carol" } },
      },
    ],
    threads: [
      {
        path: "src/checkout.ts",
        line: 6,
        resolved: true,
        comments: [
          { author: "carol", body: "Key this by cart version too?" },
          { author: "ada", body: "Good call, will do." },
        ],
      },
    ],
    commits: [
      {
        oid: sha("a1"),
        headline: "Add a cache helper",
        at: "2026-10-01T09:00:00Z",
        author: "ada",
        rollup: "SUCCESS",
      },
      {
        oid: sha("a2"),
        headline: "Use fastTotal at checkout",
        at: "2026-10-01T09:30:00Z",
        author: "ada",
        rollup: "SUCCESS",
      },
      {
        oid: sha("1"),
        headline: "Cover the cache in tests",
        at: "2026-10-01T09:45:00Z",
        author: "ada",
        rollup: "SUCCESS",
      },
    ],
    files: [
      {
        filename: "src/checkout.ts",
        status: "modified",
        additions: 4,
        deletions: 2,
        patch: smallPatch,
      },
      {
        filename: "src/generated/prices.ts",
        status: "added",
        additions: 1400,
        deletions: 0,
        patch: addedPatch(1400),
      },
      { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0 },
      {
        filename: "src/cache/index.ts",
        previous_filename: "src/cache.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
      },
    ],
  }),
  base(2, {
    title: "Rewrite the payment retries",
    author: "bob",
    body: "Retries payments with backoff.",
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    reviewDecision: "CHANGES_REQUESTED",
    checks: [
      { name: "test", status: "COMPLETED", conclusion: "FAILURE", isRequired: true },
      { name: "lint", status: "COMPLETED", conclusion: "FAILURE", isRequired: false },
    ],
    reviews: [
      {
        author: "carol",
        state: "CHANGES_REQUESTED",
        body: "Backoff needs a cap.",
        at: "2026-10-01T12:00:00Z",
      },
    ],
    threads: [
      {
        path: "src/retry.ts",
        line: 3,
        resolved: false,
        comments: [{ author: "carol", body: "Unbounded?" }],
      },
    ],
    rules: [
      ...STANDARD_RULES,
      {
        type: "required_status_checks",
        parameters: { required_status_checks: [{ context: "security-scan" }] },
      },
    ],
    files: [
      {
        filename: "src/retry.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        patch:
          "@@ -1,3 +1,5 @@\n export const retry = async (run: () => Promise<void>) => {\n-  await run();\n+  for (let attempt = 0; ; attempt++) {\n+    try { return await run(); } catch { await sleep(2 ** attempt); }\n+  }\n };",
      },
    ],
  }),
  base(3, {
    title: "WIP: new receipts page",
    isDraft: true,
    mergeStateStatus: "DRAFT",
    checks: [
      { name: "test", status: "IN_PROGRESS", conclusion: null, isRequired: true },
      { name: "lint", status: "QUEUED", conclusion: null, isRequired: false },
    ],
    files: [
      {
        filename: "src/receipts.tsx",
        status: "added",
        additions: 3,
        deletions: 0,
        patch: "@@ -0,0 +1,3 @@\n+export const Receipts = () => (\n+  <main>Receipts</main>\n+);",
      },
    ],
  }),
  base(4, {
    title: "Fix the tax rounding",
    state: "MERGED",
    checks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true }],
    events: [
      {
        type: "MergedEvent",
        actor: "fixture-owner",
        at: "2026-10-01T15:00:00Z",
        extra: { commit: { abbreviatedOid: "4444444" } },
      },
    ],
  }),
  base(5, {
    title: "Try a different currency library",
    state: "CLOSED",
    events: [{ type: "ClosedEvent", actor: "fixture-owner", at: "2026-10-01T15:00:00Z" }],
  }),
  base(6, {
    title: "Rename every module (huge diff)",
    checks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true }],
    reviewDecision: "APPROVED",
    files: [
      {
        filename: "src/generated/huge.ts",
        status: "added",
        additions: 20000,
        deletions: 0,
        patch: addedPatch(20000),
      },
      ...Array.from(
        { length: 319 },
        (_, index): FixtureFile => ({
          filename: `src/modules/m${String(index).padStart(3, "0")}.ts`,
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: `@@ -1 +1 @@\n-export const name = "old${index}";\n+export const name = "new${index}";`,
        }),
      ),
    ],
  }),
  base(7, { title: "Empty pull request", rules: [] }),
  base(9, {
    title: "Bump the SDK",
    mergeStateStatus: "BEHIND",
    reviewDecision: "APPROVED",
    checks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS", isRequired: true }],
  }),
  base(8, {
    title: "Someone else's repository",
    viewerPermission: "READ",
    checks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS", isRequired: false }],
  }),
];
