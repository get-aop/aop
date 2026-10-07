# AOP

**A coordinator that runs your AI coding agents for you.**

AOP is built around projects. A project is one long-running conversation with a coordinator: you state the goal, and it splits the work into threads. Each thread is its own Claude Code, Codex or PI session, on its own git branch and worktree. A thread that needs a decision waits for you. A thread that finishes opens a pull request, which AOP watches until it merges.

The AOP host runs on your own Mac or Linux computer. You reach it from the macOS and Windows desktop apps, a browser, or your phone. There is no hosted AOP service.

## Install

On a Mac or Linux computer:

```sh
curl -fsSL https://getaop.com/install.sh | sh
```

Desktop apps for macOS (Apple silicon and Intel) and Windows are at **[getaop.com](https://getaop.com)**.

## Links

- Website and downloads: <https://getaop.com>
- Mobile app privacy policy: [docs/PRIVACY-MOBILE.md](docs/PRIVACY-MOBILE.md)
- Report a bug or ask for a feature: [Issues](https://github.com/get-aop/aop/issues)
- Questions and ideas: [Discussions](https://github.com/get-aop/aop/discussions)
- Report a security problem: [SECURITY.md](SECURITY.md)

## About this repository

AOP is closed source. This repository holds no source code: it is where AOP takes bug reports, feature requests, feedback and security reports.

AOP is free to use under the terms in [LICENSE](LICENSE). Versions published under the MIT License before 7 October 2026 remain under it.
