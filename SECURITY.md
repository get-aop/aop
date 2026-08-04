# Security Policy

## Reporting a vulnerability

Please report security issues privately — do not open a public issue.

- **Email:** security@getaop.com (or open a private advisory via
  [GitHub Security Advisories](https://github.com/get-aop/aop-mono/security/advisories/new))
- Include: affected version, install method (installer / source / desktop),
  operating system, and a minimal reproduction if possible.

You should receive an acknowledgement within 48 hours and a plan for
disclosure within a week.

## Scope

AOP is local-first software that executes coding-agent CLIs on your machine.
The installer (`curl | sh`) and the self-update mechanism download and run
release artifacts from `getaop.com` (falling back to GitHub Releases); treat
those supply chains as part of the trust boundary. The license server and any
self-hosted deployments are separate attack surfaces.

## Supported versions

Only the latest release is supported for security fixes. Releases are
published from `main`; check `https://getaop.com/latest/version` for the
current version.
