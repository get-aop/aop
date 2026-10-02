# The Issues tab

The threads panel's Issues tab (opened from its "+" menu) lists the issues of a project's sources: the GitHub issues of every repository attached to the project, and the issues of one Linear team or project when the host owner connected Linear. It groups them, searches and filters them, opens their pull requests in the PR View, and asks the coordinator to start a thread for one. Every client, paired devices included, reads through the host.

## Where it lives

| Part | Code |
| --- | --- |
| Wire types (`ProjectIssue`, `IssueList`, `LinearConnection`, …) | `packages/common/src/projects/issues.ts` |
| Host domain: list, start a thread, Linear connection | `apps/local-server/src/issues/` |
| Shared GitHub access (`gh` auth, repositories, GraphQL, conditional REST) | `apps/local-server/src/github/` |
| The tab, its rows, toolbar, notices and Linear dialog | `apps/dashboard/src/projects/issues/` |

## Host API

| Route | Who | What |
| --- | --- | --- |
| `GET /api/projects/:id/issues?state=open\|closed\|all&limit=&refresh=0\|1` | any client | Every source's issues, newest update first, and each source's status |
| `POST /api/projects/:id/issues/start-thread` `{key}` | any client | Sends the coordinator the issue's title, link and body (read fresh) as a plain message; answers the message |
| `GET /api/projects/:id/linear` | any client | Whether Linear is connected and to which team or project; never the key |
| `PUT /api/projects/:id/linear` `{apiKey?, scope}` | host owner | Checks the key with Linear, then keeps it and the mapping; without `apiKey` it keeps the stored key |
| `DELETE /api/projects/:id/linear` | host owner | Removes the key |
| `POST /api/projects/:id/linear/catalog` `{apiKey?}` | host owner | The teams and projects a key (or the stored one) can see |

A source's status is `ok`, `not-authenticated` (the host's `gh` is not logged in), `gh-missing`, `no-github-remote` (a repository whose remotes are not on github.com), `not-configured` (no Linear), `unauthorized` (Linear refused the key) or `error`. A source that fails keeps serving the issues it read last, marked `stale`.

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

## Pull request chips

Each linked pull request is a chip coloured by state (open, draft, merged, closed) with a dot for its checks while open (passing, failing, running). A chip of a pull request in one of the project's repositories opens it in the PR View (`openPullRequestView`) in the coordinator column, with the Issues tab still showing; a pull request in another repository, or a Cmd/Ctrl-click, opens GitHub.
