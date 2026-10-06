# Railway infrastructure

`railway.ts` describes the whole EzVisa project on Railway: the `server` service, Postgres and two buckets, all in Singapore. Railway's older `railway.json` files are deprecated and are not used here.

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
