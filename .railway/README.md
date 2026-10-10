# Railway infrastructure

`railway.ts` describes the whole EzVisa project on Railway, all in Singapore: the `server` service, the `jobs` cron service, Postgres and two buckets. Railway's older `railway.json` files are deprecated and are not used here.

- `server` serves the dashboard, `/trpc`, `/auth` and `/mcp`, plus the OAuth endpoints MCP connectors such as claude.ai use (`/.well-known/*`, `/register`, `/authorize`, `/token`, `/revoke`). On start it sets the `documents` bucket's CORS rule so browsers on `APP_URL` can upload straight to it.
- Do not accept the variables Railway suggests from `.env.example`: they are local values (localhost database, S3Mock, `S3_FORCE_PATH_STYLE`). A localhost `APP_URL` is ignored in production, with a warning in the logs.
- `APP_URL` is also the OAuth issuer. Set it once to the URL people use, and change it only when you move domains: connectors must then be connected again.
- `jobs` runs `packages/core/dist/scripts/daily.js` at 01:00 UTC (08:00 in Bangkok) and exits: it schedules reminders for new or changed deadlines and marks today's as due. Running it by hand is safe. Locally, run `pnpm job:daily`.

## First setup (once, by hand)

1. Install the Railway CLI and sign in.

   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. Create or link the project, then preview and apply.

   ```bash
   railway link
   railway config plan
   railway config apply
   ```

3. In the Railway dashboard, set the Postgres region to Singapore when it is first created, turn on point-in-time recovery, enable PR environments, and set the server's watch paths to `apps/**`, `packages/**` and `pnpm-lock.yaml`.
4. Create a project token scoped to `production` and save it as the `RAILWAY_TOKEN` secret in GitHub.
5. From a Railway shell on the server, create the roles and the owner, then the owner's first token. The token is printed once.

   ```bash
   SEED_OWNER_EMAIL=<owner email> node packages/core/dist/scripts/seed.js
   node packages/core/dist/scripts/token-create.js --employee <owner email> --label "Namtarn laptop"
   ```

## After that

Change `railway.ts` in a pull request. The `Railway config` workflow comments the plan on the pull request and applies it when the pull request merges.
