# Issues

A project's Issues tab lists the issues of its sources side by side: the GitHub issues of every repository attached to the project, the issues of one Linear team or project, and the issues of Jira projects or a JQL query. Open it from the threads panel's "+" menu (**Issues**), or at `/projects/<id>/issues`. How it works inside: [architecture/issues-tab.md](./architecture/issues-tab.md).

## Sources

| Source | How AOP reads it | Set up |
| --- | --- | --- |
| GitHub | The host's `gh` login | Attach repositories with a GitHub remote (project settings › Environment), and run `gh auth login` on the host machine once |
| Linear | A personal API key | The tab's Linear button, or project settings › Issue sources |
| Jira | Jira Cloud: the account's email and an API token. Jira Data Center or Server: a personal access token | The tab's Jira button, or project settings › Issue sources |

Keys and tokens are stored on the host only, one file per project under `$AOP_HOME/connections/`, readable by the host's user only. Paired devices see whether a tracker is connected and what it shows, never the key, and only the host owner (the dashboard on the host machine) can connect, change or remove one. Removing a project removes its keys.

AOP only reads from Linear and Jira. It never comments on, edits or moves an issue there.

## Connecting Jira

1. Open the Jira dialog (the Jira mark beside Refresh in the Issues tab, or project settings › Issue sources › Jira).
2. Pick **Jira Cloud** or **Data Center / Server**.
   - Cloud: the site address (`https://your-team.atlassian.net`), the email of your Atlassian account, and an API token from [Atlassian account › Security › API tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Read access is all AOP uses.
   - Data Center or Server: the site address and a personal access token (your Jira profile › Personal Access Tokens).
3. **Test connection** signs in and names the account. **Continue** is offered once the test passed with exactly the values in the fields.
4. Pick the projects whose issues this project shows. By default that is their open issues (everything not in a Done status), newest update first. **Advanced: filter with JQL** takes a query instead of, or on top of, the projects (`assignee = currentUser() AND labels = backend`); an `ORDER BY` in it replaces newest first. The tab's Open, Closed and All are added to the query, so it need not say.
5. **Connect**. AOP runs the query once first; one Jira cannot run is refused with Jira's own message.

A site address must be `https://`; plain `http://` is accepted only for a Jira on the host machine itself.

### When Jira refuses the token

Atlassian API tokens expire, and a token can be revoked. When Jira answers a read with 401, the tab shows **Jira refused the saved token** with a **Reconnect Jira** button that opens the dialog on its token step; the issues read last stay listed until then. The dialog's **Test connection** tries the saved token at any time.

### When Jira asks to slow down

Jira answers bursts with 429 and a time to wait. AOP waits out a short one by itself; for a longer one it shows **Could not read Jira**, keeps listing the issues it read last, and does not ask Jira again, Refresh included, until that time has passed.

## The list

Every source's issues are in one table grouped by status (or label, milestone, assignee, repository or project), each row with its source mark, its key (`#12`, `ENG-12`, `ABC-12`), title, priority, labels (and Jira components), linked pull requests, assignee and when it last changed. Jira statuses group by their category: To Do with the open work, In Progress with what has started, Done with what is finished; an issue resolved as not to be done ("Won't Do", "Duplicate") reads as canceled under its resolution's name.

Search matches keys, titles, labels, components, people and status names. Filter narrows by label, assignee, author and source.

## An issue

Clicking a title opens the issue where the coordinator chat is (Cmd or Ctrl-click opens it at its source instead): its status, priority, people, labels, fix version or milestone, its description, Jira's acceptance criteria when the project has that field, and its latest comments, all read fresh from the source. Its buttons start a thread for it, open it at its source, or copy its link. Escape or **Coordinator** gives the chat its place back.

## Starting a thread from an issue

**Start a thread** (on a row, in its menu, or in the issue view) sends the coordinator the issue's key, title, link and description, plus its acceptance criteria when there are any, as a message in the project chat; the coordinator briefs a thread from it as it does for anything you ask.

For a Jira issue, the message also asks the thread to start its pull request's title with the issue's key (`APP-12: …`), which is how Jira's GitHub integration links a pull request to an issue. Turn **Put the issue's key in the titles of pull requests** off in the Jira dialog to leave titles alone.
