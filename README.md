# AOP

AOP is being rebuilt around **Projects**. In the new design, a project is one long-running conversation with a coordinator. You state the goal and the coordinator splits the work into **threads**. Each thread is its own coding-agent session on Claude Code, Codex CLI, or PI, works on its own git branch, and reports back to the coordinator.

The AOP host runs on your own machine and is reached over Tailscale. Every computer you use, through the macOS and Windows desktop apps or a browser, syncs to that one host: the same projects, threads, memory, and settings everywhere, with nothing to set up twice. There is no hosted AOP service.

## Status

AOP is alpha software, and this repository is in the middle of the rewrite. The Projects experience is being built in pieces and is not usable yet. What the code builds today is the earlier local dashboard (Sessions, tasks, and workflows), and those features are being deleted. The builds published at [getaop.com](https://getaop.com) are that earlier product. Expect breaking changes.

## What stays

- **Three runtimes.** Claude Code, Codex CLI, and PI are the supported agent CLIs. Install and authenticate the ones you want on the host; see [Runtimes](./docs/RUNTIMES.md).
- **Git and pull requests.** The worktree, branch, and pull-request flow runs through the GitHub CLI and is kept as the way finished work lands; see [GitHub-native session workflow](./docs/session-github-workflow.md).
- **Your machine.** The server keeps its state under `~/.aop/` on the host and runs as a background launchd or systemd user service, so closing a client does not stop work.

## Try the current build

Install from source. It needs Bun, Git, and at least one supported agent CLI.

```bash
git clone https://github.com/get-aop/aop-mono.git
cd aop-mono
./install
```

The installer builds AOP, links the `aop` CLI, registers the background user service, and opens the dashboard at `http://aop.localhost:25150`.

To remove it, run `./uninstall`. It stops the service and unlinks the CLI, and it leaves `~/.aop/` intact.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Runtimes](./docs/RUNTIMES.md) | The three supported agent CLIs and where their state lives |
| [MCP](./docs/MCP.md) | Tools that MCP-capable runtimes can call, and how the endpoint is authenticated |
| [Pull requests](./docs/session-github-workflow.md) | Worktree, pull request, checks, and merge flow |
| [CLI](./apps/cli/README.md) | Commands of the `aop` HTTP client |
| [Architecture](./docs/architecture/README.md) | The previous architecture, kept until it is rewritten |
| [Releasing](./docs/RELEASE.md) | Cutting a release and publishing installers |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [aop/README.md](./aop/README.md). Repository-wide verification commands are documented there.

## Acknowledgements

AOP's chat interface presentation is derived from [T3 Code](https://github.com/pingdotgg/t3code) (MIT, © 2026 T3 Tools Inc.), and its dashboard primitives are built on [shadcn/ui](https://github.com/shadcn-ui/ui) (MIT, © 2023 shadcn). Full attribution and license texts live in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

AOP is [MIT licensed](./LICENSE).
