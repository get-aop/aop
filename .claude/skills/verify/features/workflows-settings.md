# Workflows and Settings

Settings is a dialog over the dashboard with sections for General, Repositories, Runtimes, Execution hosts, Workflows, and About. The Workflows section lists the workflow definitions that workers and sessions run, and shows each one's step count.

## Sub-features

- `settings-open` opens the Settings dialog from the rail footer.
- `settings-nav` switches sections with `settings-nav-<section>`.
- `workflows-list` lists workflows with their step counts.

## How to get to it (user POV)

- Choose **Settings** in the rail footer (`data-testid=rail-footer-settings`) or press `⌘,`.
- Choose **Workflows** in the rail footer, or `settings-nav-workflows` inside the dialog.
- Open `/settings`.

## Driving it with verify-stack and drive

Preconditions:

- A started and seeded run; the seed created the workflow `aop-default-gpt` with three steps.

- **Open Workflows.** In Chrome, navigate to `<dashboard>/`, click `data-testid=rail-footer-settings`, wait for `data-testid=settings-dialog`, click `data-testid=settings-nav-workflows`, wait for `data-testid=workflow-row`, read its text, and take a screenshot.
- **Read the row.** The `text:` output is `aop-default-gpt`, `3 steps · runs as-is`, `Legacy`. The screenshot shows the dialog with the Workflows section and that row.
- **Second view.** Run `curl -s <api>/api/workflows`. The `workflows` list contains `aop-default-gpt`.
- **Proof.** Keep `settings-workflows.png`, the `text:` output, and the API response, with the feature ID `workflows-settings`.

## Gotchas

- The row shows `Legacy` for the workflow the seed creates through `POST /api/workflows` with `stepIds` (the call `e2e-tests` uses). Whether editor-built workflows differ was not checked. Editing and saving in the editor (`data-testid=workflow-editor`, `workflow-editor-step`) has not been driven for this map.
- The list fills after an async fetch; wait for `workflow-row` before reading it, or the count is zero.
- The Settings dialog is a Radix dialog (`role=dialog`, `data-state=open`). Use `settings-dialog` to wait for it, not a fixed sleep.
- Runtimes and Execution hosts sections read the user's real agent CLIs and auth homes. Open them only to look; do not change anything.
