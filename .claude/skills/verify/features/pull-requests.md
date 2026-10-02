# Pull requests tab

The threads panel's **Pull requests** tab lists the pull requests of every GitHub repository attached to the project, read by the host's `gh` (`GET <api>/api/projects/<id>/github/pulls`). Choosing one opens it in the PR View where the coordinator chat is. Never call the real GitHub: run the stack with the fake `gh` first on `PATH` (see "Threads and git" in [Projects](./projects.md)).

## Preconditions

- Stubs and the fake `gh` on `PATH` for `start` (and every `restart-server`), then `seed.ts --name <run> --fake-runtime`.
- `<fakegh>` = `FAKE_GH_DIR=<home>/fake-gh bun .claude/skills/verify/scripts/fake-gh.ts`. Seed pull requests with `<fakegh> fake seed-pulls acme/widget 120` and `<fakegh> fake seed-pulls acme/storefront 9` (states, drafts, labels, authors, assignees, review decisions, checks, comments).
- Give the fixture repo a GitHub remote: `git -C <repoPath> remote add github https://github.com/acme/widget.git` (the host reads `origin`, else the first github.com remote). Register a second repo whose `origin` is `git@github.com:acme/storefront.git` and a third with no GitHub remote.
- Projects: one on all three repos, one on the local repo only (`no-github-repos`), one with no repos (`no-repos`).
- A thread whose pull request is listed: start a thread on the fixture repo and open its pull request (`POST <api>/api/threads/<id>/pull-request`, needs a bare origin), or for a list-only check write a `pr` artifact for `acme/widget#<n>` on a thread row.

## Recipes

- **Open the tab (`prs-open`).** On the project home, `panel-add` (the "+") opens a menu: New thread, then a checkbox item per tab. `panel-add-tab-pull-requests` opens the tab at `/projects/<id>/pull-requests` and keeps it on the strip (per project, per device); `panel-tab-close-pull-requests` closes it.
- **Rows (`prs-rows`).** Each `pr-row` shows the state icon (open, draft, merged, closed), title, `acme/<repo> #n`, author avatar, `updated … ago`, comments, labels in their colours, `branch → base`, the review decision, assignee avatars, the checks icon (passing, failing, pending; its tooltip counts them), and `pr-thread-link` ("Thread") on a thread's pull request, which opens that thread.
- **Filters (`prs-filters`).** State (`pr-state-open|closed|merged|all`), `pr-filter-author|label|assignee` (searchable multi-select lists with counts; the order stays put while the list is open), `pr-involves`, `pr-search` (title, `#n`, branch, repo, author; Escape clears it, `/` focuses it), `pr-sort` (six orders), `pr-filters-clear`. Filters are kept per project on the device.
- **Open in the PR View (`prs-select`).** Clicking a row (or Enter on its title) goes to `/projects/<id>/pull-requests/pulls/<repoId>/<n>`: the PR View replaces the chat, the tab stays, the row is marked. Up/Down move between rows.
- **Paging and refresh (`prs-paging`).** 50 rows a page, `pr-load-more` loads more. `pr-refresh` reads GitHub again (`refresh=1`); the list is read again every minute while the page is visible, from the host's cache unless GitHub changed (a 304 to the ETag probe; see `calls.log`).
- **States (`prs-states`).** Loading skeleton (`pr-loading`); `pr-empty`; `pr-unavailable` with `data-reason` `signed-out` (`<fakegh> fake auth signed-out`, then Check again after 10 s), `no-repos`, `no-github-repos`; a failed read with a list shown (`<fakegh> fake graphql-fail API rate limit exceeded`, then Refresh after 3 s): the rows stay and `pr-repo-errors` names the repository. A repository over the cap (`seed-pulls … 600`) shows `pr-truncated`.
- **Widths (`prs-widths`).** Drag the panel divider to its narrowest and use the overlay and phone layouts (zoom in): the toolbar wraps, the rows stay readable.
- **Paired device.** The route is behind device auth like every `/api` route; a paired device reads through the host's `gh`.
