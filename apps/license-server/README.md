# AOP license server

Thin HTTP service for **Lemon Squeezy** license activation and validation. Deploy this on Railway (or any host); the desktop `local-server` calls it — users never receive your Lemon API key.

The hosted service only validates entitlement. The actual orchestration remains local: `local-server` enforces how many active worker lanes a plan can use for concurrent workflow execution.

## Railway

1. Create or reuse a Railway service connected to the `aop-mono` repository.
2. Set the service root directory to `/` because the license server imports shared workspace packages.
3. Set the Railway config file path to `/apps/license-server/railway.toml`.
4. Use the Railpack builder. The config file sets the start command to `bun run --filter @aop/license-server start` and the healthcheck path to `/health`.
5. Set variable `LEMON_SQUEEZY_API_KEY` from [Lemon Squeezy → Settings → API](https://app.lemonsqueezy.com/settings/api). Test-mode keys are fine for sandbox validation; replace with a live key after Lemon Squeezy verification.
6. Deploy; copy the public URL (e.g. `https://aop-license-production.up.railway.app`).
7. Confirm `https://<service>/health` returns `{ "ok": true }`.
8. Point AOP installs at it with `AOP_LICENSE_SERVER_URL`, or persist it after install:

   ```bash
   aop config:set license_server_url https://aop-license-production.up.railway.app
   ```

Railway sets `PORT`; the server listens on `0.0.0.0` by default.

If you later attach a custom domain, prefer a stable operator URL such as `https://license.getaop.com` so released clients and docs do not depend on Railway's generated hostname.

## Local

```bash
cd apps/license-server
cp .env.example .env   # add LEMON_SQUEEZY_API_KEY
bun run start
```

See [docs/licensing.md](../../docs/licensing.md) for signed friend keys, Lemon Squeezy products, and checkout URLs. HTTP routes and request shapes are defined in source (`src/server.ts`, `src/activate.ts`, `src/validate.ts`).
