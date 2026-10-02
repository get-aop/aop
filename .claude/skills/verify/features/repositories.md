# Repositories

Repositories lets a user register a local git repository with AOP, choose it when creating a project, see it in status, and remove it together with its AOP data.

## Sub-features

- `repo-init-cli` registers a path with `aop repo:init`.
- `repo-attach-ui` opens the attach dialog from the New project dialog or from Settings, Repositories.
- `repo-status` lists registered repositories.
- `repo-remove-cli` removes one after the user types its name.

## How to get to it (user POV)

- Run `aop repo:init [path]` in a terminal (defaults to the current directory).
- In the New project dialog choose **Attach a repository** (`data-testid=new-project-attach-repo`); the attached repository appears in the dialog's list, already ticked.
- Open **Settings → Repositories** and choose **Attach repository**.
- Run `aop repo:remove [path]`.

## Driving it with verify-stack and drive

Preconditions:

- A started and seeded run; the seeded repo is `repo`.
- A second git repo to register, made in the run's scratch dir: `R2=$PWD/.work/verify/<run>/fixtures/second; mkdir -p $R2 && git -C $R2 init -q -b main && git -C $R2 config user.email v@a && git -C $R2 config user.name v && echo x > $R2/a && git -C $R2 add . && git -C $R2 commit -qm i`.

- **Register.** Run `bun $S/verify-stack.ts aop --name <run> -- repo:init $R2`. Exit code `0`, and the log line reads `Repository registered` with `repo_…` and the path.
- **Confirm in status.** Run `curl -s <api>/api/status`. `repos` contains names `repo` and `second`.
- **Open the attach dialog.** In Chrome, navigate to `<dashboard>/`, click `data-testid=new-project-button` (the + in the top bar), then `data-testid=new-project-attach-repo`, find `data-testid=attach-repo-dir`, and take a screenshot. A directory browser opens on top of the New project dialog, listing the entries of `$HOME` (the first is `Applications`). Escape closes the attach dialog first, then the New project dialog.
- **Attach through the dialog.** Click a directory entry with `click:[data-testid=attach-repo-dir]` (entries are relative to `$HOME`); a git repository shows `data-testid=attach-repo-git-badge` and enables `data-testid=attach-repo-confirm`. A plain folder shows no badge and leaves confirm disabled. This flow comes from the deleted Playwright dashboard suite; it has not been re-driven for this map because scratch repos live deep under the checkout.
- **Remove.** Run `printf 'second\n' | bun $S/verify-stack.ts aop --name <run> -- repo:remove $R2`. The prompt reads `This permanently deletes all AOP data for second. Type second to continue:`, then `Repository removed`.
- **Confirm removal.** Run `curl -s <api>/api/status` again. `repos` holds only `repo`.
- **Proof.** Keep the `repo:init` and `repo:remove` output, both `/api/status` responses, and `repos-attach-dialog.png`.

## Gotchas

- The attach dialog starts at `$HOME`. To attach a repo deep in the checkout, use `repo:init` or click through each folder.
- `repo:remove` reads its confirmation from stdin, so an agent must pipe the repo's directory name.
- Per the README, removing the last repository resets AOP runtime data but keeps runtime auth homes. Never remove `repo` in a run you still need to seed-drive.
- The server rejects a folder that is not a git repository (`POST /api/repos` answers `Not a git repository`); this was not run through the CLI.
