# GitHub App assigned PR integration

Read-only GitHub App path for assigned pull request context. The integration is intentionally narrow: it gives the dashboard enough PR metadata for operator briefing without adding review automation or write actions.

This context supports the workflow handoff loop. AOP can show PRs beside worker tasks and CI repair actions without requiring broad GitHub permissions or moving orchestration out of the local server.

## Minimal permissions

Configure the GitHub App with these repository permissions only:

| Permission | Access | Reason |
| --- | --- | --- |
| Metadata | Read-only | Required by GitHub Apps and used for repository identity. |
| Pull requests | Read-only | Reads title, number, state, URL, and updated time for assigned PRs. |
| Issues | Read-only | GitHub exposes PR assignee search through the issues search API. |

No write permissions, repository contents, checks, deployments, administration, or webhooks are required for the first slice.

## Install and credential ownership

- AOP stores the GitHub App id and private key in local-server settings.
- `github_app_private_key` is masked as a secret setting and is never sent back to the dashboard in plain text.
- Private keys may be saved with real newlines or escaped `\\n` newline sequences.
- The GitHub App callback stores the `installation_id`, account login, and optional user login under server-side settings.
- AOP does not persist GitHub access tokens. It mints a short-lived installation token only during assigned PR sync.

Callback endpoint:

```text
GET /api/github/app/callback?installation_id=<id>&setup_action=install&account_login=<org>&user_login=<login>
```

## Assigned PR sync

The dashboard reads assigned PR context through:

```text
GET /api/github/assigned-prs
```

The response is read-only and limited to concise summary fields:

- repository full name
- PR number and title
- state
- URL
- author
- review context such as `Assigned to <login>`
- updated timestamp

In deterministic test/demo mode, `AOP_TEST_MODE=true` plus `AOP_TEST_GITHUB_FIXTURES_PATH` makes the sync read a local fixture instead of calling GitHub.
