# Issues tab

The threads panel's Issues tab: GitHub issues of the project's repositories and a Linear team's or project's issues, grouped, searched and filtered, with pull request chips, Start thread, and the Linear connection. Architecture: `docs/architecture/issues-tab.md`.

## Entry points

- `issues-open`: the panel's "+" (`New thread or tab`) menu, item **Issues**; or the address `/projects/<id>/issues`.
- `issues-browse`: search (`/` focuses it, Escape clears), Open/Closed/All, Filter (Label, Assignee, Author, Source), view menu (Group by Status/Label/Milestone/Assignee/Repository; Sort Recently updated/Newest/Oldest/Most commented), group headers fold.
- `issues-actions`: a row's Start-thread button (on hover) and `…` menu (Start a thread, Open in GitHub/Linear, Copy link), the title link, pull request chips, Refresh, Load older issues.
- `issues-linear`: the summary bar's Linear button and the Connect/Reconnect notices; the dialog's key step, team/project step, Change team or project, Replace key, Disconnect (asks once more).
- `issues-states`: loading, empty, no source, gh signed out or missing, a source failing (stale list), Linear refused, host unreachable (Could not refresh / Could not load issues + Try again), a paired device.

## Fixtures (never the real GitHub or Linear)

- A fake `gh` for issues: `scripts/fake-gh-issues.ts` (delegates everything else to `fake-gh.ts`). Put a two-line wrapper named `gh` first on the server's `PATH`. It serves 17 issues of `acme/<repo>` (12 open, linked pull requests in every state and checks), a 304 to a matching `If-None-Match`, and logs every call to `$AOP_HOME/fake-gh/calls.log` (`probe … 304`, `graphql issues … after=N`). Controls, with `FAKE_GH_DIR=$AOP_HOME/fake-gh`: `gh issues-fixture touch` (edits issue #133, new ETag), `many`/`few` (+120 old issues), `sign-out`/`sign-in`, `fail`/`recover` (HTTP 502); a file `slow` delays reads 4 s; a repository named `*-empty` has no issues.
- A fake Linear: `bun $S/fake-linear.ts --port <p>`, and start the stack with `AOP_LINEAR_API_URL=http://127.0.0.1:<p>/graphql`. The only key it accepts is `lin_api_fixture`; it serves teams App/Operations, project Onboarding revamp, and 7 issues across every workflow state.
- Give the seeded repo a GitHub remote: `git -C <repoPath> remote add upstream https://github.com/acme/widgets.git` (origin stays local), then `POST <api>/api/projects {name, repoIds:[<repoId>]}` with `--fake-runtime` seeded, since Start thread sends the coordinator a message.

## Gotchas

- Serve the built dashboard from the host for long browser runs (`bun run --filter @aop/dashboard build`, then `restart-server` with `DASHBOARD_STATIC_PATH=$PWD/apps/dashboard/dist`) and open `<api>/projects/…`. The dev dashboard's proxy (and `serve-proxy.ts`) keep proxied streams open across server restarts; with three projects Chrome's six connections fill up and the page hangs on its splash or on "Loading the conversation…".
- Chrome's View › Zoom In at a 500 px window clips every tab's right edge; for phone widths use an iframe harness page (`<iframe width=390>`, same origin through a small proxy).
- CUA's background `press_key` Return does not always reach Chrome; use `delivery_mode: "foreground"` for Enter in forms.
- Opening a title link or a cross-repository chip opens a new tab on github.com (404 for the fixture repositories); close it before pressing keys.

## Proof

Screenshots of: the "+" menu, the panel-width tab, row hover and menu, every grouping and sort, the filter submenus, Closed and All (finished groups folded beside open work, open while filtering), the Linear dialog steps, the connected tab with Linear groups, a PR chip opening the PR View, Refresh after `touch`, Load older, outage and signed-out notices, empty and no-source states, loading, host down, the expanded panel, 900 px overlay and a 390 px frame, and a paired device. Second views: `calls.log` (304 probes, paging cursors), `GET /api/projects/<id>/linear` (no key), `stat` of the key file (0600) and `grep` of the logs for the key (none).
