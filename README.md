# EzVisa

AI-native visa and relocation concierge for foreigners in Thailand, built around Namtarn's visa-agent practice in Chiang Mai.

The idea in one line: a **case operating system** where every client has cases, every case type has a versioned playbook per immigration office, AI prepares the paperwork, and humans validate and execute.

## Documents

| Doc | What it covers |
|---|---|
| [docs/01-business-plan.md](docs/01-business-plan.md) | Preliminary business plan: problem, market, offer and pricing, operating model, projections, legal and compliance, KPIs, 90-day roadmap |
| [docs/02-orchestration.md](docs/02-orchestration.md) | How the pieces fit: domain model, case pipeline, human-in-the-loop rules, knowledge base loop, system architecture, MVP scope |
| [docs/03-open-questions.md](docs/03-open-questions.md) | Questions to validate with Namtarn before building |
| [docs/04-mvp-spec.md](docs/04-mvp-spec.md) | MVP technical spec: monorepo layout, Postgres schema, token auth, MCP tools, dashboard screens, reminders, Railway deployment, milestones |

The dashboard mockup is a clickable design canvas: [EzVisa Dashboard Mockup](https://claude.ai/artifact/9wYcfb4LczHrm8zdNjktcV).

## Status

M0 to M3 are built and tested locally. The MCP server exposes 51 tools over clients, cases, documents, templates, reminders and the team, each token seeing only what its role allows. The dashboard signs in with the same tokens and runs the work end to end:
- adding clients and opening cases
- updating the checklist and moving stages, with the guards explained
- uploading documents and template forms straight to storage
- sending reminders
- editing and publishing templates
- managing the team, access tokens and the agency colour

A daily job schedules the reminders. What remains before Namtarn uses it for real is the Railway setup (M0's deployment step).

## Repository

| Path | What |
|---|---|
| `apps/server` | Express 5: `/health`, `/auth` (token sign-in, session cookie), `/trpc` (dashboard API), `/mcp` (token-authenticated MCP); serves the dashboard build in production |
| `apps/web` | React 19 + Vite dashboard: TanStack Router and Query, tRPC client, Tailwind v4 |
| `packages/db` | Prisma 7 schema, migrations and client |
| `packages/core` | Domain logic: tokens, permissions, errors; seed and token scripts |
| `packages/mcp` | MCP server definition |
| `packages/ui` | Theme engine: one accent colour gives the whole palette, contrast-checked |
| `packages/config` | Shared TypeScript presets |
| `.railway/railway.ts` | Railway infrastructure: server, Postgres and two buckets in Singapore |

Workspace packages export their TypeScript source under the `@ezvisa/source` condition. Type-checking, `tsx` and Vite read the source directly. Builds and Node at runtime read the compiled `dist`.

## Getting started

Requires Node 24 and Docker. pnpm comes through corepack.

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:deploy
pnpm db:seed
pnpm dev
```

The seed prints an owner token once. The dashboard runs at http://localhost:5173 and the server at http://localhost:3000. Sign in to the dashboard with that token: it becomes an httpOnly session cookie for 30 days, and the token itself is never kept in the browser.

### Without Docker

Prisma ships a local Postgres. Without S3 settings, documents are stored on disk in `.data/storage` (development only).

```bash
pnpm db:local
```

Leave that running, copy its `postgres://` URL into `DATABASE_URL` in `.env` and set `DATABASE_POOL_MAX=1` (that local Postgres mixes up queries arriving on parallel connections), then:

```bash
pnpm db:deploy && pnpm db:seed && pnpm db:sample && pnpm dev
```

`pnpm db:sample` loads four templates, a validator and a runner, nine clients and six cases at different stages, with dates relative to today. Set `SEED_OWNER_TOKEN` and `SEED_ASSISTANT_TOKEN` in `.env` before seeding to get fixed tokens for local testing.

## Connecting Claude

Any MCP client that can send a header works. With Claude Code:

```bash
claude mcp add --transport http ezvisa http://localhost:3000/mcp --header "Authorization: Bearer <token>"
```

Use a token created for the employee the assistant acts as. The seed creates "Claude" (assistant@ezvisa.local) with the Assistant role, which can draft and flag but never verify, approve or delete:

```bash
pnpm token:create --employee assistant@ezvisa.local --label "Claude Code"
```

## Tests

Unit tests always run. Integration tests run against `TEST_DATABASE_URL` and are skipped when it is not set. They empty that database before every test, so never point it at real data. Docker Compose creates `ezvisa_test` for this on first start.

## Everyday commands

| Command | Does |
|---|---|
| `pnpm dev` | Server and dashboard with live reload |
| `pnpm lint` / `pnpm format` | Biome check, or check and fix |
| `pnpm typecheck` | Every package, plus the Railway file |
| `pnpm test` | Vitest in every package, integration tests included when `TEST_DATABASE_URL` is set |
| `pnpm build` | Compiled packages and the dashboard bundle |
| `pnpm db:migrate` | Create a migration after editing `schema.prisma` |
| `pnpm db:studio` | Browse the database |
| `pnpm token:create --employee <email> --label "<label>"` | New access token, printed once |
| `pnpm token:list` / `pnpm token:revoke --id <id>` | Manage tokens (the owner can also do this in Settings) |
| `pnpm job:daily` | The daily reminder job, as Railway runs it at 08:00 Bangkok time |

Deployment and infrastructure changes are described in [.railway/README.md](.railway/README.md).
