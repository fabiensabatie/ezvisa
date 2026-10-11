# Railway infrastructure

`railway.ts` describes EzVisa's part of the Railway project **considerate-vitality** (workspace FSOFTWARE), all in Singapore: the `ezvisa` and `jobs` services, the `Postgres` database and the `documents` bucket. Railway's older `railway.json` files are deprecated and are not used here.

The project also runs services from other repositories. `railway.ts` therefore exports a named partial, `partial = "ezvisa"`. An apply manages only the resources the file declares and leaves the others alone. Keep that export: without it, an apply would treat the file as the whole project and delete everything else in it.

| Resource | What it does |
|---|---|
| `ezvisa` | Serves the dashboard, `/trpc`, `/auth`, `/mcp` and the OAuth endpoints MCP connectors such as claude.ai use (`/.well-known/*`, `/register`, `/authorize`, `/token`, `/revoke`). Migrations run in its pre-deploy step and `/health` gates each deploy. On start it sets the `documents` bucket's CORS rule so browsers on `APP_URL` can upload straight to it. |
| `jobs` | Cron service. It runs `packages/core/dist/scripts/daily.js` at 01:00 UTC (08:00 in Bangkok) and exits. The job schedules reminders for new or changed deadlines, marks today's as due and clears expired OAuth codes and tokens. Running it by hand is safe. Locally, run `pnpm job:daily`. |
| `Postgres` | The database. Services reach it over the private network. |
| `documents` | Client documents and template forms. The `documents-backup` bucket (spec 12.6) is added together with the nightly backup job. |

Variables point at the resources through references (`${{Postgres.DATABASE_URL}}`, `${{documents.ENDPOINT}}`…), so no secret is written in this repository. `APP_URL` is also the OAuth issuer: change it only when moving to a custom domain, and connect MCP connectors again afterwards.

## Planning and applying

Railway reads this file only when someone runs the CLI. A deploy never applies it.

1. Install the Railway CLI (5.42.1 or newer, which evaluates the file), sign in, and link this directory to **considerate-vitality**, environment `production`.

   ```bash
   npm install -g @railway/cli
   railway login
   railway link
   ```

2. Preview, then apply.

   ```bash
   railway config plan
   railway config apply
   ```

   The first apply claims the declared resources for the `ezvisa` partial. Its plan also removes variables that were set by hand on `ezvisa` and are not declared here: `TEST_DATABASE_URL`, `BACKUP_S3_*`, `S3_FORCE_PATH_STYLE`, `RAILPACK_BUILD_CMD` and `RAILPACK_START_CMD`. Those removals are expected; nothing uses them. Any other change in the plan deserves a look before confirming.

3. Optionally, apply from pull requests: create a project token scoped to `production` and save it as the `RAILWAY_TOKEN` secret in GitHub. The `Railway config` workflow then comments the plan on each pull request that touches `.railway/` and applies it on merge. Until that secret exists, the workflow cannot reach Railway.

## Seeding a new environment

From a Railway shell on `ezvisa`, create the roles and the owner, then the owner's first token. The token is printed once.

```bash
SEED_OWNER_EMAIL=<owner email> node packages/core/dist/scripts/seed.js
node packages/core/dist/scripts/token-create.js --employee <owner email> --label "Namtarn laptop"
```
