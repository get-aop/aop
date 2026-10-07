# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

- **Email:** security@getaop.com
- **Or** open a private report: [Report a vulnerability](https://github.com/get-aop/aop/security/advisories/new)

Include the affected version (`aop --version`), how you installed AOP (installer or desktop app), your operating system, and the steps to reproduce it if you can.

You should get an acknowledgement within 48 hours and a plan for disclosure within a week.

## Scope

AOP runs coding-agent CLIs on your own machine. The installer (`curl | sh`) downloads and runs release files from `getaop.com`; that supply chain is part of the trust boundary.

## Supported versions

Only the latest release gets security fixes. The newest version is described at <https://getaop.com/releases/latest.json>.
