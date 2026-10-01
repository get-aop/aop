# Settings

Settings is a dialog over the dashboard for host-level settings, with sections for General, Repositories, Runtimes, Devices (host owner only) and About. A project's own settings are a screen of the project, and Devices has its own recipe (see [Project settings, memory, usage and Devices](./projects-settings.md)).

## Sub-features

- `settings-open` opens the Settings dialog from the sidebar footer.
- `settings-nav` switches sections with `settings-nav-<section>`.
- `settings-name` sets the name the Overview greets the host owner by (General > Profile).
- `settings-run-cap` sets how many thread turns the host runs at once (General > Runs).
- `settings-about` shows the host's version (About).

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
- **Name (`settings-name`).** Open Settings: General starts with the group **Profile** and the field `data-testid=setting-display_name` ("Your name"), empty (`curl -s <api>/api/settings/display_name` shows `""`). With it empty, a project's `overview-greeting` reads `Welcome back.`. Type `Ada Lovelace` and wait for "Settings saved"; close the dialog: without a reload the greeting reads `Welcome, Ada.` on a project with no thread ready for review, landing or resolved, and `Welcome back, Ada.` on one that has such a thread (open a thread and click `thread-resolve-button`, "Mark resolved", to see it change). The API now shows `"Ada Lovelace"`. Clear the field: `Welcome back.` again.
- **Run cap (`settings-run-cap`).** Open Settings (General is the first section) and find the group **Runs** with the field `data-testid=setting-max_concurrent_runs`, reading `4` (`curl -s <api>/api/settings/max_concurrent_runs` shows `"4"`). Select the field, type `1`, and wait for the toast "Settings saved" (about a second: the value saves 600 ms after the last keystroke). `GET <api>/api/settings/max_concurrent_runs` now shows `"1"`, and a project with three threads started at once shows one working and two queued (see [Projects](./projects.md), `projects-scheduling`). Then type `0` (also `33`, `4.5`, `abc`, or clear the field): `data-testid=setting-error-max_concurrent_runs` (`role=alert`) reads "Enter a whole number from 1 to 32.", the field has `aria-invalid=true`, no toast appears, and after two seconds the API still answers `"1"`. Type `4` to put the default back. A valid edit in another field (Global instructions) still saves while the cap is invalid.
- **About (`settings-about`).** Click `data-testid=settings-nav-about`, wait for `data-testid=section-about`: it reads `AOP` and the version the host reports on `GET <api>/api/health` (`v0.9.51` for a release build, `dev build` when `AOP_BUILD_VERSION` is unset, as in a verify stack), and, on a host that can update itself, an update line (`about-update-status`) with Check now and, for the host owner, Update now. A verify stack runs from source, so `GET <api>/api/updates` answers `supported: false` and there is no bar or button; [Updates](./updates.md) has the recipe for an installed build. The sidebar footer shows the same version after `connection-status`.

## Gotchas

- The Settings dialog is a Radix dialog (`role=dialog`, `data-state=open`). Use `settings-dialog` to wait for it, not a fixed sleep.
- The Runtimes section reads the user's real agent CLIs and auth homes. Open it only to look; do not change anything.
