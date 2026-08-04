# AOP Binary Distribution — Deploy Guide

## Overview

AOP ships as compiled CLI/local-server binaries, macOS Tauri desktop DMGs, and a Windows
NSIS installer.
CLI users install via `curl -fsSL https://getaop.com/install.sh | sh` (macOS/Linux) or
`install.ps1` (native Windows). macOS users can download `AOP.app` as a DMG; Windows users
download `aop-windows-x64-setup.exe`.

Binaries are served as static files from `getaop.com`. No API needed.

## Server File Structure

```
/var/www/getaop.com/
  index.html                    ← install UI (curl + bun + windows tabs) from docs/install/
  install.sh                    ← install script (macOS/Linux)
  install.ps1                   ← install script (native Windows)
  latest/
    version                     ← plain text: "0.1.0"
    aop-windows-x64-setup.exe   ← durable "Download for Windows" pointer
  v0.1.0/
    aop-linux-x64               ← ~97MB
    aop-linux-arm64
    aop-darwin-x64
    aop-darwin-arm64
    aop-macos-x64.dmg
    aop-macos-arm64.dmg
    aop-windows-x64.exe         ← CLI binary
    aop-windows-x64-setup.exe   ← NSIS installer
    checksums.sha256
```

## Server Setup (One-Time)

### 1. Provision a VPS

Any cheap VPS works (Hetzner, DigitalOcean, etc.). Requirements:

- ~2GB disk per release (4 binaries x ~97MB each + checksums)
- SSH access
- HTTPS via Let's Encrypt

### 2. Point DNS

Create an A record for `getaop.com` pointing to the VPS IP.

### 3. Install nginx

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4. Configure nginx

```bash
sudo tee /etc/nginx/sites-available/getaop.com << 'NGINX'
server {
    listen 80;
    server_name getaop.com;
    root /var/www/getaop.com;

    location / {
        try_files $uri $uri/ =404;
    }

    # Correct MIME type for install script
    location = /install.sh {
        default_type text/plain;
    }

    # Correct MIME type for version file
    location = /latest/version {
        default_type text/plain;
    }

    # Binary downloads — force download, disable buffering for large files
    location ~ ^/v[^/]+/aop- {
        default_type application/octet-stream;
        add_header Content-Disposition "attachment";
        sendfile on;
        tcp_nopush on;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/getaop.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Enable HTTPS

```bash
sudo certbot --nginx -d getaop.com
```

### 6. Create the web root

```bash
sudo mkdir -p /var/www/getaop.com/latest
sudo chown -R $USER:$USER /var/www/getaop.com
```

## Releasing a New Version

Desktop releases use a local macOS primary publish and the self-hosted
`release-windows.yml` workflow. The macOS host builds the core binaries and DMGs,
creates the GitHub Release, and deploys the primary R2 assets. The Windows workflow
then builds the installer from the same release commit, waits for that GitHub Release,
attaches `aop-windows-x64-setup.exe`, regenerates the combined checksum manifest, and
updates R2, including the durable `latest/aop-windows-x64-setup.exe` pointer.

### 1. Bump, commit, tag, push (any host, once)

```bash
# Bump patch (0.1.0 -> 0.1.1), commit, tag, and push — no CI publish
bun run release patch        # or: minor | major | 0.2.0
```

This verifies a clean tree, runs `bun check` (skip with `--skip-check`), bumps
the root `package.json` (the single source of truth for the AOP version),
commits `chore: release vX.Y.Z`, tags, and pushes
(skip the push with `--no-push`).

### 2. Publish the primary release on macOS

```bash
bun run release:local --version X.Y.Z
```

This builds the signed macOS DMGs and core binaries, creates or updates the GitHub
Release, and deploys the primary assets to R2.

### 3. Publish the Windows installer

After the primary GitHub Release exists, dispatch the self-hosted Windows workflow:

```bash
gh workflow run release-windows.yml --ref main
```

The workflow waits for the matching release tag, downloads its primary assets,
attaches the installer, regenerates checksums, and redeploys the combined assets.

### Local Windows fallback

```bash
# On Windows: builds the NSIS installer and uploads it to the same release
bun run release:local --version X.Y.Z --skip-r2
```

`release:local` selects the installer by host OS (`package:macos-dmg` on macOS,
`package:windows` on Windows) and the GitHub Release step is **create-or-update**,
so whichever host runs second attaches its installer to the existing release
instead of failing. Run the R2/`latest` deploy from the macOS host; the Windows
host passes `--skip-r2` (its run cannot also produce the macOS DMGs that the R2
deploy expects). Preview any host's plan with `--dry-run`.

> Note: the durable `latest/aop-windows-x64-setup.exe` R2 pointer is only written
> by a run that has the installer on disk. Until R2 is wired to publish from the
> Windows host, attach the installer to the GitHub Release (step 2) and download
> it from there.

### Manual fallback

If CI deploy secrets are not configured yet, you can still publish locally after CI builds artifacts from a tag, or build locally:

```bash
bun run build:release
GETAOP_DEPLOY_HOST=... GETAOP_DEPLOY_USER=... GETAOP_DEPLOY_SSH_KEY=... \
  bash scripts/release/deploy-getaop.sh 0.2.0
```

### Build

```bash
# Build all 4 platform binaries (linux/darwin x x64/arm64)
bun run build:release

# Or build a single platform for testing
bun run build:release -- --target linux-x64
```

`bun run build:release` writes the binaries and `runtime-assets.tar.gz` to `dist/release/`.
After `bun run package:macos-dmg`, the release directory contains:

```
dist/release/
  aop-linux-x64
  aop-linux-arm64
  aop-darwin-x64
  aop-darwin-arm64
  aop-macos-x64.dmg
  aop-macos-arm64.dmg
  checksums.sha256
  runtime-assets.tar.gz
```

The DMGs are packaged on macOS with Tauri. The app opens to setup, asks before installing missing tools, starts the bundled AOP sidecar, and renders the dashboard inside the desktop window.

```bash
bun run package:macos-dmg
```

Without Apple credentials, the DMGs are unsigned. Add `AOP_MACOS_SIGN_IDENTITY` to sign locally. Add `AOP_MACOS_NOTARIZE=1`, `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` to notarize.

### Verify

```bash
# Check version endpoint
curl https://getaop.com/latest/version

# Test install script (dry run — read the output before piping to sh)
curl -fsSL https://getaop.com/install.sh

# Full install
curl -fsSL https://getaop.com/install.sh | sh
```

## How the Install Script Works

1. Detects OS (`uname -s`) and arch (`uname -m`)
2. Runs preflight checks for `git`, authenticated `gh`, and at least one runtime CLI (`claude`, `opencode`, `codex`, or `pi`)
3. Fetches latest version from `https://getaop.com/latest/version`
4. Downloads binary, runtime assets, and `checksums.sha256`
5. Verifies checksums and installs to `/usr/local/bin/aop` (or `~/.local/bin/aop` if no write access)
6. Starts the local server and serves the dashboard at `http://aop.localhost:25150`

Users can pin a version: `curl -fsSL https://getaop.com/install.sh | sh -s -- --version 0.1.0`

Advanced users can bypass preflight checks with `curl -fsSL https://getaop.com/install.sh | AOP_SKIP_PREFLIGHT=1 sh`.

## Local Testing

Test the binary without deploying:

```bash
# Build for current platform
bun run build:release -- --target linux-x64

# Version check
./dist/release/aop-linux-x64 --version

# Start server (foreground)
./dist/release/aop-linux-x64 run

# Start server (background)
./dist/release/aop-linux-x64 run --background
./dist/release/aop-linux-x64 status
./dist/release/aop-linux-x64 stop

# Dashboard is served at http://aop.localhost:25150/
```

## Notes

- **Binary size**: ~97MB per platform (Bun runtime is embedded)
- **SQLite**: Bundled in the Bun runtime, no external dependency
- **Dashboard**: Pre-built and embedded in the binary, served automatically
- **Desktop app**: Tauri shell with setup-first prerequisite checks and bundled sidecar resources
- **Data directory**: `~/.aop/` on macOS/Linux, `%USERPROFILE%\.aop\` on Windows (database, logs, PID file)
- **Windows**: native NSIS installer (`aop-windows-x64-setup.exe`) plus the CLI binary
  (`aop-windows-x64.exe`). Unsigned in the alpha, so SmartScreen warns on first run (choose
  "More info → Run anyway") and Defender may quarantine the unsigned `aop.exe` sidecar.
  `install.ps1` runs `Unblock-File` to clear the Mark-of-the-Web. To remove the warnings,
  set `AOP_WINDOWS_PFX_BASE64` + `AOP_WINDOWS_PFX_PASSWORD` so the release Authenticode-signs
  the installer. WSL users should install the Linux build inside their distro (Model B)
  instead of the native Windows package.
