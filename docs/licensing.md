# AOP licensing (no accounts)

AOP uses license keys only—no sign-up, email login, or user database in the app. This guide covers worker limits, checkout activation, offline-signed keys, and self-hosted license validation.

## Plans

| Plan | Price | Active workers |
|------|-------|----------------|
| Free | $0 | 4 |
| Pro | $2.99/mo | 8 |
| Team | $4.99/mo | Unlimited |

Workers are named seats created from chat (the worker card) and assigned through task cards. Free covers 4 active workers; Pro raises the ceiling to 8; Team removes it entirely for teams that run many workers in parallel. The current count and limit appear under **Settings → General + License**.

The free tier works out of the box—no key required.

## Getting a paid license

1. Open **Settings → License** in the dashboard (or use the checkout link your operator configured).
2. Complete checkout on Lemon Squeezy.
3. Copy the license key from your receipt or email.
4. Paste it under **Settings → License → Activate license**.

After activation you can create and run workers up to your plan limit. If activation fails, check the key and try again, or contact support through your checkout provider.

## Friend, demo, and comped licenses

AOP also supports signed `AOP1...` license keys that verify locally without a hosted server. Use these for friends, demos, internal testers, and comped unlimited access.

Signed keys are created with an Ed25519 private key that must never be committed:

```bash
bun run license:keygen
```

Store the generated `privateDerB64` in your secret manager as `LICENSE_SIGNING_PRIVATE_KEY`. Only the matching public key belongs in AOP source (`packages/license/src/signing-public-key.ts`).

Issue an unlimited Team key:

```bash
LICENSE_SIGNING_PRIVATE_KEY="..." bun run license:issue -- --plan team
```

Optionally make it expire:

```bash
LICENSE_SIGNING_PRIVATE_KEY="..." bun run license:issue -- --plan team --days 365
```

The recipient pastes the generated `AOP1...` key in **Settings → License**. No Lemon checkout or license server is involved.

## For operators (self-hosted AOP)

If you run your own AOP deployment and sell Pro/Team tiers, you host a small license validation service and connect Lemon Squeezy checkout. Deployment and configuration live in [apps/license-server/README.md](../apps/license-server/README.md).

The hosted service is intentionally tiny:

- `local-server` stores and enforces the user's active entitlement.
- `apps/license-server` holds your Lemon Squeezy API key and proxies activation/validation.
- Lemon Squeezy remains the purchase system; AOP does not need accounts or a user database.

Typical install configuration on machines running `local-server`:

| Variable | Purpose |
|----------|---------|
| `AOP_LICENSE_SERVER_URL` | Your hosted license server |
| `AOP_CHECKOUT_PRO_URL` | Lemon Squeezy checkout for Pro |
| `AOP_CHECKOUT_TEAM_URL` | Lemon Squeezy checkout for Team |

For a source or already-installed machine, you can also persist the license server URL through the local config API:

```bash
aop config:set license_server_url https://your-license-service.up.railway.app
```

Checkout URLs are service environment variables because they are operator/product configuration, not user-specific secrets.

## Terms

Paid tiers are optional. The core platform is [MIT-licensed](../LICENSE). Commercial use of paid worker tiers is subject to your purchase terms with the seller.

## Related guides

- [Tasks](./TASKS.md)
- [Runtimes](./RUNTIMES.md)
- [CLI](../apps/cli/README.md)
- [Architecture](./architecture/README.md)
