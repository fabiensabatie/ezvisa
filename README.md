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

Milestone M0, the scaffold, is in place: monorepo, database schema and first migration, token scripts, server with health check, dashboard shell, CI and the Railway infrastructure file. Next is M1, the MCP tools.

## Repository

| Path | What |
|---|---|
| `apps/server` | Express 5: `/health`, `/trpc`, later `/auth` and `/mcp`; serves the dashboard build in production |
| `apps/web` | React 19 + Vite dashboard, Tailwind v4, tRPC client |
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

The seed prints an owner token once. The dashboard runs at http://localhost:5173 and the server at http://localhost:3000.

## Everyday commands

| Command | Does |
|---|---|
| `pnpm dev` | Server and dashboard with live reload |
| `pnpm lint` / `pnpm format` | Biome check, or check and fix |
| `pnpm typecheck` | Every package, plus the Railway file |
| `pnpm test` | Vitest in every package |
| `pnpm build` | Compiled packages and the dashboard bundle |
| `pnpm db:migrate` | Create a migration after editing `schema.prisma` |
| `pnpm db:studio` | Browse the database |
| `pnpm token:create --employee <email> --label "<label>"` | New access token, printed once |
| `pnpm token:list` / `pnpm token:revoke --id <id>` | Manage tokens |

Deployment and infrastructure changes are described in [.railway/README.md](.railway/README.md).
