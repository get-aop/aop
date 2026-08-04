# @aop/license

Shared licensing helpers for AOP: plan limits, signed `AOP1...` keys, and Lemon Squeezy integration.

Used by `local-server` (enforcement) and `license-server` (hosted proxy). Not required for the free tier.

Plan limits map directly to active worker capacity. More active workers means more workflow lanes can run at the same time on the Pool.

See [`docs/licensing.md`](../../docs/licensing.md).

```bash
bun test
bun run typecheck
```

Operator scripts from the repo root:

```bash
bun run license:keygen
LICENSE_SIGNING_PRIVATE_KEY="..." bun run license:issue -- --plan team
```
