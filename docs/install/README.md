# Install page

Static install UI (`index.html`) with **HOST**, **DESKTOP APP** and **SOURCE** tabs, styled like a minimal product install block.

The page says what each install gives you: the host is the server that keeps your projects and runs the agents (macOS and Linux only), and the desktop app is a client that connects to a host (macOS and Windows). Windows has no host, CLI or server.

## Tabs

| Tab | What it shows |
| --- | --- |
| **HOST** | `curl -fsSL https://getaop.com/install.sh \| sh`: fetches the build for the machine, puts `aop` on PATH and starts the background service. The script is [`scripts/installer/install.sh`](../../scripts/installer/install.sh). `--no-service` installs without starting it. |
| **DESKTOP APP** | Durable download links for the macOS DMGs and the Windows installer, with the first-run warnings for unsigned builds. |
| **SOURCE** | Clone [get-aop/aop](https://github.com/get-aop/aop) and run `./install` (builds from source and registers the service). |

## Preview locally

```bash
open docs/install/index.html
# or
bunx serve docs/install
```

## Deploy (getaop.com)

`index.html` is static; copy it to the site root. `install.sh` and the download links are published by the release, not by hand: see [Releasing AOP](../RELEASE.md).
