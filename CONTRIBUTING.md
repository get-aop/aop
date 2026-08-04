# Contributing to AOP

Thank you for helping improve AOP. The project is **MIT-licensed** and stays open source; optional paid license tiers fund development without closing the repository.

## Before you open a PR

1. Read the [developer guide](./aop/README.md) for workspace layout and architecture.
2. Run focused tests for the area you changed (`bun test` runs unit/integration only; use `bun run test:e2e` when you need E2E), then `bun check` from the repo root.
3. Add or update colocated `*.test.ts` files for behavior changes.
4. Keep entrypoints thin (routes/commands → services → repositories). See [`CLAUDE.md`](./CLAUDE.md).

## Pull request expectations

- One logical change per PR when possible.
- Update README or docs when user-visible behavior, ports, env vars, install flow, workflow automation, or worker concurrency changes.
- Keep product language concrete: explain which manual agent step AOP automates, which workflow or worker owns it, and how the operator observes the result.
- Do not commit secrets, `.env` files, or local IDE config (e.g. `.cursor/`).
- Do not disable lint rules or lower coverage thresholds to make CI pass.

## Licensing (contributors)

- Application code in this repo is MIT — see [`LICENSE`](./LICENSE).
- Bundled methodology prompts are documented in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
- Commercial **Pro/Team** worker limits use optional Lemon Squeezy keys and a small hosted license server; see [`docs/licensing.md`](./docs/licensing.md). That does not affect contributing to the open-source tree.

## Getting help

- Product usage: root [`README.md`](./README.md)
- Dashboard UI map: [`apps/dashboard/README.md`](./apps/dashboard/README.md)
- Workflows: [`docs/WORKFLOW.md`](./docs/WORKFLOW.md)
- Architecture index: [`docs/architecture/README.md`](./docs/architecture/README.md)
- E2E tests: [`e2e-tests/README.md`](./e2e-tests/README.md)
