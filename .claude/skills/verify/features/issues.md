# Issues tab

The threads panel's Issues tab: GitHub issues of the project's repositories, a Linear team's or project's issues and Jira projects' (or a JQL query's) issues, grouped, searched and filtered, with pull request chips, the issue view, Start thread, and the Linear and Jira connections. Architecture: `docs/architecture/issues-tab.md`.

## Entry points

- `issues-open`: the panel's "+" (`New thread or tab`) menu, item **Issues**; or the address `/projects/<id>/issues`.
- `issues-browse`: search (`/` focuses it, Escape clears), Open/Closed/All, Filter (Label, Assignee, Author, Source), view menu (Group by Status/Label/Milestone/Assignee/Repository; Sort Recently updated/Newest/Oldest/Most commented), group headers fold.
- `issues-actions`: a row's Start-thread button (on hover) and `…` menu (Start a thread, Open in GitHub/Linear, Copy link), the title link, pull request chips, Refresh, Load older issues.
- `issues-linear`: the summary bar's Linear button and the Connect/Reconnect notices; the dialog's key step, team/project step, Change team or project, Replace key, Disconnect (asks once more).
- `issues-jira`: the summary bar's Jira button, project settings › Issue sources › Jira, the "Connect an issue tracker" notice; the dialog's Cloud / Data Center switch, Test connection (refused, then signed in), Continue, project checkboxes, Advanced JQL (a refused query, then a good one), the pull request key checkbox, Connect; connected: Test connection, Replace token, Change filter, Disconnect (asks once more); the Reconnect notice (opens on the token step) and the rate-limit notice.
- `issues-view`: a row's title (plain click opens the view, Cmd/Ctrl-click the source), the row menu's View issue, the address `/projects/<id>/issues/issue/<key>`; in the view: Start a thread, Open in <source>, Copy link, the breadcrumb, ×, Escape, Try again.
- `issues-states`: loading, empty, no source, gh signed out or missing, a source failing (stale list), Linear refused, host unreachable (Could not refresh / Could not load issues + Try again), a paired device.

## Fixtures (never the real GitHub or Linear)

- A fake `gh` for issues: `scripts/fake-gh-issues.ts` (delegates everything else to `fake-gh.ts`). Put a two-line wrapper named `gh` first on the server's `PATH`. It serves 17 issues of `acme/<repo>` (12 open, linked pull requests in every state and checks), a 304 to a matching `If-None-Match`, and logs every call to `$AOP_HOME/fake-gh/calls.log` (`probe … 304`, `graphql issues … after=N`). Controls, with `FAKE_GH_DIR=$AOP_HOME/fake-gh`: `gh issues-fixture touch` (edits issue #133, new ETag), `many`/`few` (+120 old issues), `sign-out`/`sign-in`, `fail`/`recover` (HTTP 502); a file `slow` delays reads 4 s; a repository named `*-empty` has no issues.
- A fake Linear: `bun $S/fake-linear.ts --port <p>`, and start the stack with `AOP_LINEAR_API_URL=http://127.0.0.1:<p>/graphql`. The only key it accepts is `lin_api_fixture`; it serves teams App/Operations, project Onboarding revamp, and 7 issues across every workflow state.
- A fake Jira: `bun $S/fake-jira.ts --port <p> --log <file>`. Give `http://127.0.0.1:<p>` as the site in the dialog (plain http is accepted on loopback only). Cloud signs in with `fixture@example.com` and `jira_fixture_token`; Data Center with the PAT `jira_pat_fixture`; anything else gets Jira's 401. It serves projects APP, OPS, WEB (empty) and 14 issues with ADF descriptions (tables, panels, task lists, code), an "Acceptance criteria" custom field on APP-2, comments, every status category (APP-7 is Done as "Won't Do"), priorities, labels and components, and avatars on Atlassian's and Gravatar's real hosts (Devon's points at the site and fails, for the initials fallback). Controls over HTTP: `POST /__fixture/revoke` / `restore` (401 to every request), `rate-limit?count=N&retryAfter=S` (429), `many` / `few` (+150 OPS issues, past one page), `touch`, `slow?ms=`; `GET /__fixture/calls` is the log. The host waits out a Retry-After up to 5 s; a longer one leaves Jira alone until it passes (disconnecting resets it).
- Give the seeded repo a GitHub remote: `git -C <repoPath> remote add upstream https://github.com/acme/widgets.git` (origin stays local), then `POST <api>/api/projects {name, repoIds:[<repoId>]}` with `--fake-runtime` seeded, since Start thread sends the coordinator a message.

## Gotchas

- Serve the built dashboard from the host for long browser runs (`bun run --filter @aop/dashboard build`, then `restart-server` with `DASHBOARD_STATIC_PATH=$PWD/apps/dashboard/dist`) and open `<api>/projects/…`. The dev dashboard's proxy (and `serve-proxy.ts`) keep proxied streams open across server restarts; with three projects Chrome's six connections fill up and the page hangs on its splash or on "Loading the conversation…".
- Chrome's View › Zoom In at a 500 px window clips every tab's right edge; for phone widths use an iframe harness page (`<iframe width=400>`). With the built dashboard served by the host, drop the page into `apps/dashboard/dist/` (it is not committed) and open `<api>/harness-400.html`: same origin, no proxy.
- CUA on soulf: `browser_type` with `replace: true` cannot select inside an `type=email` input; type into it empty instead. Pointer scrolling needs `delivery_mode: "foreground"`.
- CUA's background `press_key` Return does not always reach Chrome; use `delivery_mode: "foreground"` for Enter in forms.
- Opening a title link or a cross-repository chip opens a new tab on github.com (404 for the fixture repositories); close it before pressing keys.

## Proof (Jira)

Screenshots of: the dialog's refused and passing Test connection, the project step, a refused JQL, the connected summary, the mixed list with Jira rows and avatars, the issue view (facts, ADF body with a table and a task list, acceptance criteria, comments), the coordinator's brief after Start thread (key, criteria, the pull request key line), the Jira source filter and a search, Closed (Won't Do under its own name), the Reconnect notice and the token step it opens, the rate-limit notice, the JQL-filtered list, Issue sources in project settings, and the tab, dialog and issue view at 400 px. Second views: the fake's call log (page tokens, one 429 then quiet), `GET /api/projects/<id>/jira` (no token, no email), `stat` of `connections/jira/<id>.json` (0600) and a `grep` of the logs for the token (none).

## Proof

Screenshots of: the "+" menu, the panel-width tab, row hover and menu, every grouping and sort, the filter submenus, Closed and All (finished groups folded beside open work, open while filtering), the Linear dialog steps, the connected tab with Linear groups, a PR chip opening the PR View, Refresh after `touch`, Load older, outage and signed-out notices, empty and no-source states, loading, host down, the expanded panel, 900 px overlay and a 390 px frame, and a paired device. Second views: `calls.log` (304 probes, paging cursors), `GET /api/projects/<id>/linear` (no key), `stat` of the key file (0600) and `grep` of the logs for the key (none).
