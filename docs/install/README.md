# Install page

Static install UI (`index.html`) with **CURL** and **BUN** tabs, styled like a minimal product install block.

The page should sell the install target, not only the command. The copy should make clear that AOP installs a local dashboard and server for workflow-based agent orchestration: register repos, create workers, mark tasks Ready, and let automated pipelines run concurrently instead of driving every agent skill by hand.

## Commands

| Tab | What it does |
|-----|----------------|
| **CURL** | `curl -fsSL https://getaop.com/install.sh \| sh` — prebuilt binary from [`scripts/installer/install.sh`](../../scripts/installer/install.sh) |
| **BUN** | Clone [get-aop/aop-mono](https://github.com/get-aop/aop-mono) and run `./install` (source + user service) |

## Preview locally

```bash
open docs/install/index.html
# or
bunx serve docs/install
```

## Deploy (getaop.com)

Copy to your static host next to `install.sh`:

```bash
cp docs/install/index.html /var/www/getaop.com/index.html
cp scripts/installer/install.sh /var/www/getaop.com/install.sh
```

See [`scripts/installer/DEPLOY.md`](../../scripts/installer/DEPLOY.md) for the full release layout.
