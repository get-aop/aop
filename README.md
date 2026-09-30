# AOP

AOP is built around **Projects**. A project is one long-running conversation with a coordinator. You state the goal and the coordinator splits the work into **threads**. Each thread is its own Claude Code session, works on its own git branch in its own worktree, and reports back to the coordinator. A thread that needs a decision from you waits until you answer, and a thread that finishes can open a pull request, which AOP then watches.

The AOP host runs on your own machine and is reached over Tailscale. Every computer you use, through the macOS and Windows desktop apps or a browser, syncs to that one host: the same projects, threads, memory, and settings everywhere, with nothing to set up twice. There is no hosted AOP service.

## Status

AOP is alpha software. Phase 1 is Claude Code only; the host runs on macOS or Linux, and Windows and macOS are clients. The Codex CLI and PI adapters stay in the tree but are not exposed until Phase 2, and there is no cloud host or mobile client yet. The builds published at [getaop.com](https://getaop.com) are the earlier product, not this one. Expect breaking changes.

## What you need

- [Bun](https://bun.sh) and Git, to install from source.
- [Claude Code](https://code.claude.com), installed and signed in on the host. AOP does not install it or sign in for you; see [Runtimes](./docs/RUNTIMES.md).
- The [GitHub CLI](https://cli.github.com), signed in (`gh auth status`), for threads that open and merge pull requests.
- Tailscale, only to reach the host from another computer.

## Install the host

```bash
git clone https://github.com/get-aop/aop-mono.git
cd aop-mono
./install
```

The installer builds AOP, links the `aop` CLI, and registers the host as a background launchd or systemd user service, so closing a browser does not stop work. It keeps its state under `~/.aop/`. When it finishes, open `http://aop.localhost:25150` (set `AOP_OPEN_DASHBOARD=1` before `./install` to have it open the page for you).

To remove it, run `./uninstall`. It stops the service and unlinks the CLI, and it leaves `~/.aop/` intact.

## Your first project

1. Open `http://aop.localhost:25150` on the host and choose **New project**.
2. Give it a name, an optional goal, and optional instructions that go to the coordinator and every thread. Choose **Attach a repository** and pick a git repository from the host's folders. A project can start with no repository, but its threads then have no branch.
3. Open the **Coordinator** tab and say what you want done. Several tasks in one message are fine: the coordinator starts a thread for each and shows a card for every one.
4. Watch the **Threads** tab. A thread that is **Waiting on you** has a question; open it and answer with an option or your own words. Steer a running thread from its own box, or stop it.
5. When a thread's work is ready, open its pull request from the thread's pull request bar, or ask the coordinator to. AOP watches the pull request, sends the thread a fix prompt when checks fail or a reviewer asks for changes, and merges it when you ask. See [Threads and git](./docs/THREADS.md).

If a message to the coordinator comes back with `Runtime exited with code ...`, Claude Code is not installed or not signed in on the host. Fix that and send the message again.

## Use it from another computer

1. On the host, open **Settings**, then **Devices**, and choose **Generate pairing code**.
2. Publish the host on your tailnet with `tailscale serve --bg --https=443 http://127.0.0.1:25150`. Turn on MagicDNS and HTTPS certificates for your tailnet first.
3. On the other computer, open `https://<host-name>.<tailnet>.ts.net` in a browser (or the desktop app), enter the code and a name for the device, and the same projects appear.

[Running the host](./docs/HOST.md) has the details: how devices are authenticated, how to revoke one, what `tailscale serve` does and how to check that it did not open the host to the network, and the desktop app.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Running the host](./docs/HOST.md) | Pairing devices, device tokens, reaching the host with `tailscale serve`, and the desktop app |
| [Threads and git](./docs/THREADS.md) | A thread's worktree and branch, its pull request, the pull request watcher, and what is cleaned up when |
| [Run scheduling](./docs/SCHEDULING.md) | The cap on running thread turns and what happens on a usage limit |
| [Runtimes](./docs/RUNTIMES.md) | The supported agent CLI and where its state lives |
| [MCP](./docs/MCP.md) | The tools the coordinator and threads call, and how the endpoint is authenticated |
| [CLI](./apps/cli/README.md) | Commands of the `aop` HTTP client |
| [Architecture](./docs/architecture/README.md) | The previous architecture, kept until it is rewritten |
| [Releasing](./docs/RELEASE.md) | Cutting a release and publishing installers |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [aop/README.md](./aop/README.md). Repository-wide verification commands are documented there.

## Acknowledgements

AOP's chat interface presentation is derived from [T3 Code](https://github.com/pingdotgg/t3code) (MIT, © 2026 T3 Tools Inc.), and its dashboard primitives are built on [shadcn/ui](https://github.com/shadcn-ui/ui) (MIT, © 2023 shadcn). Full attribution and license texts live in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

AOP is [MIT licensed](./LICENSE).
