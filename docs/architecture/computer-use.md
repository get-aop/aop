# Computer use: CUA Driver built into the host

Threads of a project whose Computer use setting is CUA operate the AOP host's screen through [CUA Driver](https://github.com/trycua/cua): browsers, desktop apps, windows, the keyboard and mouse, and screenshots of the whole screen. This page covers how the host installs it, how it keeps to one thread at a time, what each platform needs, and the limits. The project setting itself is described in [Threads and git](../THREADS.md#computer-and-browser-use); watching a thread work is in [The live view of the host's screen](./live-view.md).

## Install

AOP installs CUA Driver itself, at the version it pins (`CUA_DRIVER_VERSION` in `packages/common/src/projects/computer-use.ts`, 0.32.0 today). Two entry points do the same work:

- The install script (`install.sh`, stable and Nightly) runs `aop computer-use setup` after it puts the binary in place, before it starts the service. From a terminal, setup can ask questions and run sudo; from `curl | sh` it reads the terminal through `/dev/tty`. Without a terminal it runs with `--no-sudo` and only prints what needs root. A setup that is not ready or fails never fails the AOP install. `--no-computer-use` (or `AOP_INSTALL_NO_COMPUTER_USE=1`) skips it.
- `aop computer-use setup` (`aop-nightly` on Nightly) can be run again at any time. It changes only what is missing or different, so a second run on a ready host runs no installer, writes no file and restarts nothing.

`aop computer-use status` prints the same readiness the dashboard shows (`--json` prints the API's object). Exit codes: `0` ready, `2` something is still missing, `1` a setup step failed.

Setup does, in order:

1. **CUA Driver**, with CUA's own installer (`https://cua.ai/driver/install.sh`, `CUA_DRIVER_RS_VERSION` pinned, `--no-modify-path`, telemetry off on a fresh install). No sudo: on Linux it lands in `~/.cua-driver/packages` with `cua-driver` linked into `~/.local/bin`; on macOS it is `/Applications/CuaDriver.app` with the same link. A missing driver is installed, an older one upgraded, one that does not answer reinstalled; a newer one is left alone.
2. **Linux: the screen.** By default a virtual display: Xvfb on `:99` (1920x1080) and openbox on it, as the user services `aop-xvfb.service` and `aop-openbox.service`, enabled and started, with linger so they also run at boot before anyone logs in. `--display :N` picks another number. When a desktop session is up (an X socket other than the virtual display's, or Wayland) and someone is at the terminal, setup asks whether threads should use that desktop instead; the default is the virtual display, so threads never move the person's own mouse and windows. Without a terminal nobody is asked and the virtual display is used. `--screen desktop|virtual` decides without asking.
3. **Linux: system packages.** What needs root is never installed silently. Setup prints ONE command, `sudo sh -c '…'`, for everything missing: Xvfb and openbox (virtual display only), the X libraries `cua-driver` links against (`libX11`, `libXi`, `libXext`, `libxcb`, `libxkbcommon`), AT-SPI (`at-spi2-core`, the accessibility bus it reads windows through), Google Chrome from Google's package (which also adds Google's apt repository, so it stays updated), ffmpeg (for the live view; optional), and `loginctl enable-linger` when the user cannot turn linger on themselves. From a terminal it asks "Run it now with sudo?" and runs it on yes (sudo asks for the password); `--no-sudo` only prints it. apt and dnf are supported; elsewhere it names the packages. Google Chrome has no arm64 Linux build, so on arm64 no command is offered for the browser.
4. **macOS:** starts Cua Driver's app when it is not running (`open -n -g -a CuaDriver --args serve`; the app holds the permissions) and reads its grants with the read-only `cua-driver permissions status`. Missing Accessibility or Screen Recording is granted with `cua-driver permissions grant`, which opens the macOS dialogs: setup runs it only from a terminal and after asking, and otherwise prints how. A thread never triggers a permission prompt.
5. **The choice** goes to `<AOP home>/computer-use.json` (`{"screen": "virtual", "display": ":99"}`). The host reads it on every use, so setup takes effect without restarting the host. Without the file, the host's own `DISPLAY` decides.

**Updates.** A host update can bring a newer pin. On boot the host upgrades an installed driver that is older than the pin, with the same user-level installer (no sudo, no prompt; on macOS it starts the app again after the swap). It never installs a driver nobody installed, never repairs a broken one (a person should see why it broke), and leaves a newer one alone. `AOP_CUA_AUTO_UPGRADE=0` turns it off. A newer upstream release than the pin is reported as news only.

## Readiness

`GET /api/computer-use/cua` (any paired device) answers whether CUA can serve threads on this host, with each check and what fixes the rest, so a checklist can show "Computer use: ready / missing X / Fix":

- `status` `ready`, `not-installed` or `not-ready`, and a `reason`: `no-answer`, `not-running` and `missing-permissions` (macOS), `no-display` (Linux: no X display is up).
- `checks`: installed, answers, running and the two grants (macOS), up to date (against the pin), and on Linux the screen (required), system packages and browser (informational: without a browser CUA Driver accepts, the browser tools fail and the desktop tools still work).
- `fix`: `command` (the host's own `aop computer-use setup`, or null when there is nothing for it to do), `sudoCommand` (the one command for what needs root, or null), `missing` (labels of each missing piece) and `pinnedVersion`.

Dashboard: Settings › Computer use shows this checklist with Copy buttons, the pinned version, Check again, and who holds the screen. The project settings row shows the same steps as a guide (`cuaSetupSteps`).

## One thread at a time

The host has one screen, so one thread at a time drives it, and the host enforces it.

**The gate.** A thread no longer starts `cua-driver mcp` itself. Its run gets an HTTP MCP server named `cua-driver` at `/api/mcp/cua`, authenticated with the same per-session token as the AOP tools (see [MCP](../MCP.md#loopback-authentication)); the tool names stay `mcp__cua-driver__*`. Only a thread's session gets through, never a coordinator's. Behind it the host runs one `cua-driver mcp` process per thread (started on the thread's first request, with `DISPLAY` from the host's config) and passes every request to it. Everything but a tool call (initialize, tool lists, CUA's skill resources) passes at once. The initialize answer adds a paragraph about the lease to CUA Driver's own instructions.

**The lease.** A thread's first tool call takes the lease if nobody holds it and nobody waits. Otherwise the call waits in line, first come first served. A thread that holds the lease gets every call through, parallel ones too.

**Waiting.** A call that has to wait is answered as a server-sent event stream. Every 10 seconds an MCP progress notification says who has the screen and where the thread stands ("Waiting for computer use: "Fix the footer" is using it; this thread is 2nd in line."), and the tool's own result follows on the same stream once the lease comes. Claude Code keeps a streamed call open (checked with Claude Code 2.1.288: a call answered after 400 seconds came back fine, with the CLI's own heartbeats every 30 seconds). A call never waits more than a minute: it then answers, as an error, that it is still waiting and did not run, and the thread keeps its place for 2 minutes so calling again does not send it to the back. The wait is kept short because a message steered into the thread reaches it only once the call it is on ends (see [Messages sent while a turn runs](./README.md#messages-sent-while-a-turn-runs)). A waiting call the client drops (the turn was interrupted) leaves the line.

**Giving it back.** The lease is released:

- after `end_session` returns (the answer does not wait for the cleanup; a next call waits in line until it is done);
- when the thread's turn ends, whether it finished, was stopped, or its CLI crashed (the run's end in `chat-session/runtime-engine.ts`, or in `run-recovery.ts` for a run that outlived a host restart); a thread in line leaves it then too;
- after 3 minutes without a CUA call (`IDLE_MS`), never while a call is still running;
- for a place granted to a reservation, after 2 minutes if the thread does not call.

Before the next thread gets the screen, the host ends what the last one left open: `end_session` for every CUA session label it used and for its implicit session (each closes the browser it launched and deletes its throwaway profile), then its `cua-driver` process. The cleanup is bounded (15 seconds), so a stuck driver never stalls the line.

**What the thread is told.** The system prompt of a thread with the CUA tools says they are for browser and computer use, that AOP enforces one thread at a time (do non-screen work first, take no lock of its own), to call `end_session` as soon as it is done and never hold the screen through test suites or builds, and to use isolated throwaway browser profiles for testing unless the person allows their own.

**State.** `GET /api/computer-use/lease` (any paired device) answers `{holder, queue, idleReleaseMs}`: the holder is a thread (`threadId`, `projectId`, `title`, `since`, `lastCallAt`) or `external` (see below), and the queue lists waiters with their `position` (1 is next). The live view's status (`GET /api/computer-use/live`) carries the same object as `lease`, which the dashboard already polls every 3 seconds: thread cards say "Waiting for computer use (2nd in line)" or "Using computer use", an open thread shows a notice, and the live view's header names the holder and how many wait.

**The old lock directory.** Before the host enforced it, threads took `/tmp/aop-cua.lock` by hand (`mkdir`, their title in `owner`, `touch heartbeat` every few minutes; stale after 15 minutes). The lease honours it both ways while such threads still run: a fresh lock someone else holds is shown as an `external` holder and keeps the line waiting; a stale one is removed; while a thread of the host holds the lease, the host takes the directory itself (owner `AOP host lease: <title>`, a marker file, a heartbeat every minute) and removes it on release, so old-style threads wait too. A lock whose owner names the calling thread is that thread's own and does not block it. `AOP_CUA_LOCK_DIR` moves the directory (an isolated stack on its own display uses its own) and `off` turns it off. The directory is meant to go once no thread follows the old convention.

Code: `apps/local-server/src/computer-use/` — `lease.ts` (queue and release rules), `external-lock.ts`, `mcp-gate.ts` (waiting, progress, end_session), `driver-client.ts` and `driver-pool.ts` (the per-thread driver processes and their cleanup), `gate-routes.ts`, `host-gate.ts` (the host's one lease, pool and gate), `setup/` (install, readiness, `aop computer-use`).

## Platforms

| | Linux | macOS |
| --- | --- | --- |
| Driver | `~/.cua-driver`, `~/.local/bin/cua-driver` | `/Applications/CuaDriver.app` |
| Screen | Virtual display (Xvfb + openbox user services, default `:99`) or the person's X desktop | The Mac's own screen |
| Needs root | Xvfb, openbox, X libraries, AT-SPI, Google Chrome, ffmpeg, linger: one sudo command | Nothing |
| Permissions | None | Accessibility and Screen Recording, granted to Cua Driver at the Mac |
| Browser | A root-owned Google Chrome, Chromium or Edge at CUA Driver's fixed paths (not the chromium snap) | Any; `browser_prepare` launches its own |
| Live view | ffmpeg x11grab | Not supported yet |

## Limits

- One screen per host, so one thread at a time; everything else waits. Threads should keep their screen time short.
- Wayland desktops are not driven directly; CUA Driver on Linux works with X11 (Xwayland's display, or the virtual display).
- A host restart ends the driver processes it ran without an `end_session` for their sessions; the lease starts empty on the new host, and a thread's next call takes it again.
- The lease covers threads of this host. Another program on the machine that does not take the lock directory is not stopped.
- The 10-minute wait per call is a bound, not a deadline: a thread that keeps calling keeps its place.
