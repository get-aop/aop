# Remote execution hosts

Run agent CLIs (Claude Code, Codex, OpenCode, …) on another machine on your LAN
over SSH while AOP's dashboard and local server stay on your laptop.

## Requirements

On the **AOP server machine** (where `aop` / local-server runs):

- OpenSSH client (`ssh`, `scp`/`rsync`)
- Key-based access to the remote host **without a passphrase prompt** for the
  identity you configure (or an unlocked agent). AOP uses `BatchMode=yes`.

On the **remote host**:

- POSIX shell (`sh`), `git`, and `rsync`
- Agent CLIs installed and authenticated for the providers you use
- A writable directory for workspaces (the **remote root**)

## Setup checklist

1. From the AOP machine, confirm SSH works non-interactively:

   ```bash
   ssh -o BatchMode=yes user@remote-host true
   ```

2. In AOP **Settings → Execution hosts**, add a host:
   - **Name** — display label
   - **Host** — hostname or IP
   - **User** / **Port** / **Identity file** — optional SSH options
   - **Remote root** — absolute path AOP may use (e.g. `/home/you/aop-workspaces`)

3. Click **Test connection**. You should see reachability, rsync/git presence, and
   which CLIs are installed/authenticated.

4. Under **Runtime profile → Runs on**, bind a profile to the host (or leave
   **This machine** for local execution).

## How a remote step runs

1. AOP creates a `git bundle` of the task branch and rsyncs the worktree
   (excluding `.git`) into `<remoteRoot>/<taskId>`.
2. The agent CLI is spawned via SSH with the remote workdir as cwd. Local stdout
   is still the existing step `.jsonl` log (the local process is `ssh`).
3. On completion (success or failure), AOP rsyncs changes back and best-effort
   fetches remote commits into the local branch.
4. Abort kills the local `ssh` process and runs
   `pkill -f AOP_STEP_ID=<stepId>` on the remote host.

## Troubleshooting BatchMode failures

| Symptom | Likely cause |
| --- | --- |
| Test connection unreachable | Host/port wrong, firewall, or SSH not listening |
| Permission denied (publickey) | Wrong identity file, key not authorized on remote, or passphrase-protected key without agent |
| Hang / timeout | Network path blocked; AOP uses `ConnectTimeout=5` |
| CLI missing in test results | Install/auth the CLI on the **remote** host, not the laptop |
| Step fails "not configured" | Profile points at a deleted host — re-bind **Runs on** |

## Limits (v1)

- POSIX remotes only (no Windows SSH targets)
- No password auth; keys are not stored in AOP
- Remote steps do not survive a local-server restart
- Chat, channels, terminal, openclaw, and hermes stay local
