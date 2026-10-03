# The Issues tab

The threads panel's Issues tab (opened from its "+" menu) lists the issues of a project's sources: the GitHub issues of every repository attached to the project, the issues of one Linear team or project, and the issues of Jira projects or a JQL query, when the host owner connected those. It groups them, searches and filters them, opens one in the issue view, opens their pull requests in the PR View, and asks the coordinator to start a thread for one. Every client, paired devices included, reads through the host. User guide: [ISSUES.md](../ISSUES.md).

## Where it lives

| Part | Code |
| --- | --- |
| Wire types (`ProjectIssue`, `IssueList`, `LinearConnection`, …) | `packages/common/src/projects/issues.ts` |
| Wire types of one issue read whole (`IssueDetail`) and of Jira (`JiraConnection`, …) | `packages/common/src/projects/issue-detail.ts`, `jira.ts` |
| Host domain: list, issue view, start a thread, Linear connection, the connection files | `apps/local-server/src/issues/` |
| Jira: REST client, ADF to Markdown, mapping, JQL, loader, connection service and routes | `apps/local-server/src/issues/jira/` |
| Shared GitHub access (`gh` auth, repositories, GraphQL, conditional REST) | `apps/local-server/src/github/` |
| The tab, its rows, toolbar, notices and Linear dialog | `apps/dashboard/src/projects/issues/` |
| The Jira dialog and the issue view | `apps/dashboard/src/projects/issues/jira/`, `…/issues/view/` |
| Project settings › Issue sources (both dialogs) | `apps/dashboard/src/projects/settings/IssueSourcesSection.tsx` |

## Host API

| Route | Who | What |
| --- | --- | --- |
| `GET /api/projects/:id/issues?state=open\|closed\|all&limit=&refresh=0\|1` | any client | Every source's issues, newest update first, and each source's status |
| `GET /api/projects/:id/issues/detail?key=` | any client | One issue read fresh from its source: its row, its body as Markdown, Jira's acceptance criteria, its latest 50 comments and how many it has |
| `POST /api/projects/:id/issues/start-thread` `{key}` | any client | Sends the coordinator the issue's reference, title, link, body and acceptance criteria (read fresh) as a plain message; answers the message |
| `GET /api/projects/:id/linear` | any client | Whether Linear is connected and to which team or project; never the key |
| `PUT /api/projects/:id/linear` `{apiKey?, scope}` | host owner | Checks the key with Linear, then keeps it and the mapping; without `apiKey` it keeps the stored key |
| `DELETE /api/projects/:id/linear` | host owner | Removes the key |
| `POST /api/projects/:id/linear/catalog` `{apiKey?}` | host owner | The teams and projects a key (or the stored one) can see |
| `GET /api/projects/:id/jira` | any client | Whether Jira is connected: deployment, site, account name, filter, whether pull request titles carry the key; never the token or the email |
| `PUT /api/projects/:id/jira` `{credentials?, filter, linkPullRequests}` | host owner | Signs in (`/myself`), runs the filter for one issue, then keeps both; without `credentials` it keeps the stored ones |
| `POST /api/projects/:id/jira/test` `{credentials?}` | host owner | Who the credentials (or the stored ones) sign in as, and the projects they see |
| `DELETE /api/projects/:id/jira` | host owner | Removes the token |

A source's status is `ok`, `not-authenticated` (the host's `gh` is not logged in), `gh-missing`, `no-github-remote` (a repository whose remotes are not on github.com), `not-configured` (no Linear or Jira), `unauthorized` (Linear refused the key, or Jira the token: revoked or expired) or `error`. A source that fails keeps serving the issues it read last, marked `stale`.

An issue's list key is `github:owner/name#12`, `linear:ENG-12` or `jira:ABC-12`. Each issue carries a `priority` (`{name, level}`, level `urgent`…`lowest` or null for a scheme's own names; null for GitHub).

## Reading GitHub without spending the rate limit

The host reads a repository's issues with GraphQL (100 a page, one rate-limit point each), including each issue's linked pull requests ("Development" links, which `Fixes #12` makes) and their head commit's check rollup. It keeps what it read per repository and state filter, and:

- answers from memory for 15 seconds without asking GitHub at all;
- after that, probes `repos/{owner}/{name}/issues?state=all&sort=updated&per_page=1` with the ETag of its last probe. A `304` is free against GitHub's rate limit and means no issue or pull request changed, so the held issues are served;
- reads again when the probe changed, when the person presses Refresh after a change, and at least every five minutes, since a check run finishing does not move the probe;
- pages on from its cursor when the tab asks for more (Load older issues), instead of reading from the top;
- shares one read between requests for the same list.

The tab asks again every minute while the page is visible, so a visible tab costs one free probe a minute per repository.

## Linear

The host owner pastes a personal API key in the Linear dialog (from the tab's Linear button or its "Connect Linear" notice), AOP lists the workspace's teams and projects, and the owner picks one. The key is kept on the host only, in `$AOP_HOME/connections/linear/<project id>.json` (mode 0600, in a 0700 directory), outside the database and outside the project's directory, which the coordinator and repo-less threads work in. It is sent to Linear in the `Authorization` header and nowhere else: not in logs, error messages, or any answer to a client. Removing the project removes its key. `AOP_LINEAR_API_URL` points the host at another Linear endpoint (verification uses a fake).

Linear has no conditional requests, so the host keeps its read for a minute and Refresh reads again.

## Jira

The host owner gives the site, then Jira Cloud's account email and API token (Basic auth on REST API v3) or a Data Center or Server personal access token (Bearer on REST API v2), tests them (`/myself`), and picks projects, a JQL query, or both. The credentials, the account name and the filter are kept in `$AOP_HOME/connections/jira/<project id>.json` under the same rules as Linear's key (`connection-store.ts` is the one store both use, and removing a project removes both). The token goes in the `Authorization` header and nowhere else. A site must be `https://`, or `http://` on loopback (a Jira on the host, or the verification fake); requests never follow redirects, so a token is never resent to another host.

- **Search.** Cloud uses `POST /rest/api/3/search/jql` with `nextPageToken` paging (the old `/rest/api/3/search` is removed; the first page sends no token, Jira refuses a null one; a page with no issues ends the list, so a token that never runs out cannot loop). Data Center uses `POST /rest/api/2/search` with `startAt` against `total`. Pages hold 100 issues and ask only for the fields a row shows; comments are read only by the issue view.
- **JQL.** `(project in ("A", "B")) AND (<the person's query>) AND (statusCategory != Done) ORDER BY <the query's order, or updated DESC>` (`jira-jql.ts`); Closed is `statusCategory = Done`, All adds nothing. The query is parenthesised so its `OR`s cannot swallow the rest; its `ORDER BY` is split off outside quotes. Saving runs it once, and a 400 is refused with Jira's message.
- **Mapping** (`jira-mapping.ts`). `statusCategory` `new` is unstarted, `indeterminate` started, `done` completed, or canceled when the resolution reads as not done ("Won't Do", "Duplicate"), named by the resolution. Priorities map by name (Highest/Blocker urgent … Lowest/Trivial lowest). Labels and components are both labels; the first fix version is the milestone; `+0000` offsets become ISO times; any avatar or link that is not http(s) is dropped.
- **Descriptions and comments** are Atlassian Document Format on Cloud, converted to Markdown on the host (`adf-markdown.ts`: headings, lists, task lists, code, panels, tables, mentions, emoji, cards; media become `[attachment]`; text is escaped so it cannot make links or HTML; depth is capped). Data Center sends wiki markup, shown as escaped plain text. A custom field whose name contains "acceptance criteria" (found with `expand=names`) is a section of its own.
- **Caching and limits** (`jira-issues.ts`). A list is reused for a minute, two requests share one read, Refresh reads again. A 429 or 503 with a `Retry-After` up to 5 s is waited out in place, at most twice; a longer one is answered as an error and nothing is asked of Jira for that project until it has passed, Refresh included, while the issues read last are served.
- **Briefs.** A thread started from a Jira issue gets its key, title, link, description and acceptance criteria, and, unless the owner turned it off, a line asking it to start its pull request's title with the key, which links them in Jira's GitHub integration. AOP writes nothing to Jira.

Data Center support is the same client with the v2 paths and a Bearer token; it is covered by the unit tests and the verification fake, not by a real Data Center.

### Not built yet

- **Write actions.** A comment (`POST /rest/api/3/issue/{key}/comment` with an ADF body) and a status change (`GET …/transitions`, then `POST …/transitions {transition: {id}}`) would each be one owner-confirmed button in the issue view, with a token that has write scope. They are left out so the integration stays read-only.
- **Linking an issue to a thread or pull request** in AOP itself (none of the sources has it yet). Jira links pull requests by the key in their title, which the brief asks for.
- **Data Center avatars** sit behind the site's login, so they fall back to initials.

## The issue view

A row's title opens the issue where the coordinator chat is (`/projects/:id/…/issue/<key>`, `IssuePane`), like the PR View: a plain click opens the view, a modified click the source. The host reads the issue fresh each time (`GET …/issues/detail`): GitHub with one GraphQL query (the row's fields, the body, the last 50 comments), Linear with one query (the same fields as the list, the description, the last 50 comments), Jira with `GET /issue/{key}?fields=*all&expand=names`. Markdown renders through the chat's renderer, which shows raw HTML as text.

## Avatars in the desktop app

The desktop app's content security policy lists the image hosts the Issues tab, the PRs tab and the PR View load people's pictures from (`apps/desktop/electron/app-protocol.ts`): GitHub's and Linear's, and for Jira Cloud `avatar-management--avatars.us-west-2.prod.public.atl-paas.net` and `secure.gravatar.com`. Nothing else: a picture an issue links to stays blocked. Gravatar's default picture (a person with no Gravatar) redirects through `i0`–`i2.wp.com`, WordPress's open image proxy, which would let any image through, so it is not allowed and those people show their initial in the desktop app (the browser, which the host serves without a CSP, shows the picture). A picture that does not load shows the person's initial.

## Pull request chips

Each linked pull request is a chip coloured by state (open, draft, merged, closed) with a dot for its checks while open (passing, failing, running). A chip of a pull request in one of the project's repositories opens it in the PR View (`openPullRequestView`) in the coordinator column, with the Issues tab still showing; a pull request in another repository, or a Cmd/Ctrl-click, opens GitHub.
