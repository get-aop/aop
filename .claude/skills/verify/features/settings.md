# Settings

Settings is a dialog over the dashboard for host-level settings, with sections for General, Repositories, Runtimes, Devices (host owner only) and About. A project's own settings are a screen of the project, and Devices has its own recipe (see [Project settings, memory, usage and Devices](./projects-settings.md)).

## Sub-features

- `settings-open` opens the Settings dialog from the sidebar footer.
- `settings-nav` switches sections with `settings-nav-<section>`.

## How to get to it (user POV)

- Choose **Settings** in the sidebar footer (`data-testid=sidebar-settings`) or press `⌘,`.
- Choose a section in the dialog's side nav (`data-testid=settings-nav-<section>`).

## Driving it with verify-stack and drive

Preconditions:

- A started and seeded run; the seeded repo is `repo`.

- **Open Settings.** In Chrome, navigate to `<dashboard>/`, click `data-testid=sidebar-settings`, wait for `data-testid=settings-dialog`, and take a screenshot. The side nav lists General, Repositories, Runtimes, Devices and About for the host owner (a browser on the host itself); there is no Workflows or Execution hosts entry, and a paired device is not shown Devices.
- **Open Repositories.** Click `data-testid=settings-nav-repositories`, wait for `data-testid=section-repositories`, read the rows with `data-testid=settings-repo-row`, and take a screenshot. One row reads `repo` with its path and an actions menu; there is no task-count badge.
- **Second view.** Run `curl -s <api>/api/status`. The `repos` list contains `repo`.
- **Proof.** Keep `settings-repositories.png`, the `text:` output, and the API response, with the feature ID `settings`.

## Gotchas

- The Settings dialog is a Radix dialog (`role=dialog`, `data-state=open`). Use `settings-dialog` to wait for it, not a fixed sleep.
- The Runtimes section reads the user's real agent CLIs and auth homes. Open it only to look; do not change anything.
