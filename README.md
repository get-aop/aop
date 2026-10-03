# AOP

AOP is built around **Projects**. A project is one long-running conversation with a coordinator. You state the goal and the coordinator splits the work into **threads**. Each thread is its own Claude Code session, works on its own git branch in its own worktree, and reports back to the coordinator. A thread that needs a decision from you waits until you answer, and a thread that finishes can open a pull request, which AOP then watches.

The AOP host runs on your own machine and is reached over Tailscale. Every computer you use, through the macOS and Windows desktop apps or a browser, syncs to that one host: the same projects, threads, memory, and settings everywhere, with nothing to set up twice. There is no hosted AOP service.

## Status

AOP is alpha software. Phase 1 is Claude Code only; the host runs on macOS or Linux, and Windows and macOS are clients. The Codex CLI and PI adapters stay in the tree but are not exposed until Phase 2, and there is no cloud host or mobile client yet. Releases are published at [getaop.com](https://getaop.com) (see [Releasing](./docs/RELEASE.md)), and [AOP Nightly](./docs/NIGHTLY.md), a build of `main` after every merge, installs beside them. Expect breaking changes.

## What you need

- [Bun](https://bun.sh) and Git, to install from source.
- [Claude Code](https://code.claude.com), installed and signed in on the host. AOP does not install it or sign in for you; see [Runtimes](./docs/RUNTIMES.md).
- The [GitHub CLI](https://cli.github.com), signed in (`gh auth status`), for threads that open and merge pull requests.
- Tailscale, only to reach the host from another computer.

## Install the host

The host runs on macOS and Linux. Windows has no host: use the desktop app there and connect it to a host on a Mac or Linux computer.

From a release, one command downloads the build for your machine, puts `aop` on your PATH and starts the host as a background service (launchd on macOS, systemd on Linux):

```bash
curl -fsSL https://getaop.com/install.sh | sh
```

It needs Git, the GitHub CLI signed in, and Claude Code signed in on that machine, and it says what is missing before it changes anything. `--no-service` installs the files without starting the service; run the host yourself with `aop run`. To pin a version, add `--version X.Y.Z` (`sh -s -- --version X.Y.Z`). It ends with the next steps: `aop pair` to pair another device, the `tailscale serve` command that reaches the host from your other devices, and where updates and setup live.

From source:

```bash
git clone https://github.com/get-aop/aop.git
cd aop
./install
```

The source installer builds AOP, links the `aop` CLI, and registers the host as a background launchd or systemd user service, so closing a browser does not stop work. Either way the host keeps its state under `~/.aop/`. When it finishes, open `http://aop.localhost:25150` (set `AOP_OPEN_DASHBOARD=1` before `./install` to have it open the page for you).

Until the host has everything it needs, the home page shows a "Set up this host" checklist: the service, reaching it from your other devices, Claude Code, GitHub, computer use and updates, each with a Fix or the command to run. It is always on AOP settings › Host. [Set up a host](./docs/HOST.md#set-up-a-host) has the details.

To remove a source install, run `./uninstall`. It stops the service and unlinks the CLI, and it leaves `~/.aop/` intact. To remove a release install, stop the service (`launchctl unload ~/Library/LaunchAgents/com.aop.local-server.plist` on macOS, `systemctl --user disable --now aop-local-server` on Linux), delete that service file, and delete `aop` and the `dashboard` folder next to it (in `/usr/local/bin` or `~/.local/bin`).

## Install the desktop app

The desktop app for macOS (Apple silicon or Intel) and Windows connects to a host. You do not need it on the host itself, where the dashboard opens in a browser. Download it from [getaop.com](https://getaop.com). On first launch it asks for a host: **This Mac** runs the host on that Mac, and **Another computer** takes the host's address and a pairing code. The macOS app is signed and notarized. The Windows app is not signed yet, so SmartScreen warns once: choose More info, then Run anyway. [Running the host](./docs/HOST.md#the-desktop-app) has the details.

## Your first project

1. Open `http://aop.localhost:25150` on the host and choose **New project**.
2. Give it a name, an optional goal, and optional instructions that go to the coordinator and every thread. Choose **Attach a repository** and pick a git repository from the host's folders: folders that are repositories carry a badge, you can type a path, and `~` is the host's home folder. A linked git worktree can be attached as it is (AOP keeps the path you chose, and each thread still gets a worktree of its own from the same repository); the dialog also offers to attach the worktree's main repository instead. `aop repo:init <path>` accepts the same folders. A project can start with no repository, but its threads then have no branch.
3. Open the **Coordinator** tab and say what you want done. Several tasks in one message are fine: the coordinator starts a thread for each and shows a card for every one.
4. Watch the **Threads** tab. A thread that is **Waiting on you** has a question; open it and answer with an option or your own words. Steer a running thread from its own box, or stop it.
5. When a thread's work is ready, open its pull request from the thread's pull request bar, or ask the coordinator to. AOP watches the pull request, sends the thread a fix prompt when checks fail or a reviewer asks for changes, and merges it when you ask. See [Threads and git](./docs/THREADS.md).

If a message to the coordinator comes back with `Runtime exited with code ...`, Claude Code is not installed or not signed in on the host. Fix that and send the message again.

## Use it from another computer

1. Publish the host on your tailnet with `tailscale serve --bg --https=443 http://127.0.0.1:25150` (AOP Nightly: `tailscale serve --bg --https=25650 http://127.0.0.1:25650`). Turn on MagicDNS and HTTPS certificates for your tailnet first.
2. Get a pairing code: run `aop pair` on the host (`aop-nightly pair` for Nightly), or open **AOP settings › Host › Pair a device** and choose **Generate pairing code**. Any paired device that may manage the host can make one too.
3. On the other computer, open `https://<host-name>.<tailnet>.ts.net` in a browser (or choose **Another computer** in the desktop app), enter the code and a name for the device, and the same projects appear.

[Running the host](./docs/HOST.md) has the details: how devices are authenticated, who may manage the host, how to revoke a device, what `tailscale serve` does and how to check that it did not open the host to the network, and the desktop app.

## Updates

The **Updates** button in the top bar shows when something can be updated: **This app** (the desktop app), the **host**, and Claude Code on the host. **Update host** works from any paired device by default, so a host on another computer updates without SSH. When turns are running, it asks first, and **Update when they finish** waits for them. **AOP settings › Updates** holds every update setting: how the host installs updates (Stable asks by default, Nightly installs when no turn is running) and who can update the host. On the host itself, `aop update` does the same. [Updating AOP](./docs/HOST.md#updating-aop) has the details.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Running the host](./docs/HOST.md) | Setting up a host, pairing devices, who may manage the host, reaching it with `tailscale serve`, the desktop app, and updating AOP |
| [AOP Nightly](./docs/NIGHTLY.md) | The build of `main` that installs beside stable AOP and keeps itself current |
| [Threads and git](./docs/THREADS.md) | A thread's worktree and branch, its pull request, the pull request watcher, and what is cleaned up when |
| [Run scheduling](./docs/SCHEDULING.md) | The cap on running thread turns and what happens on a usage limit |
| [Routines](./docs/ROUTINES.md) | Recurring work on a schedule: schedules and DST, missed runs, caps, and the coordinator's routine tools |
| [Runtimes](./docs/RUNTIMES.md) | The supported agent CLI and where its state lives |
| [MCP](./docs/MCP.md) | The tools the coordinator and threads call, and how the endpoint is authenticated |
| [CLI](./apps/cli/README.md) | Commands of the `aop` HTTP client |
| [Architecture](./docs/architecture/README.md) | How projects, threads, the chat engine and the clients fit together, and the deeper guides on each part |
| [Releasing](./docs/RELEASE.md) | Cutting a release, what it publishes, and signing the builds |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [aop/README.md](./aop/README.md). Repository-wide verification commands are documented there.

## Acknowledgements

AOP's chat interface presentation is derived from [T3 Code](https://github.com/pingdotgg/t3code) (MIT, © 2026 T3 Tools Inc.), and its dashboard primitives are built on [shadcn/ui](https://github.com/shadcn-ui/ui) (MIT, © 2023 shadcn). Full attribution and license texts live in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

AOP is [MIT licensed](./LICENSE).
