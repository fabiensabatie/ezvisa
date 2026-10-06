# EzVisa — MVP Technical Spec

**Version:** 0.2 (draft, Railway deployment added) · **Date:** 2026-10-06
**Scope:** an MCP server with token identification and CRUD over the business data, plus a React dashboard that signs in with the same token.
**Inputs:** [02-orchestration.md](02-orchestration.md) for the domain, and the [dashboard mockup](https://claude.ai/artifact/9wYcfb4LczHrm8zdNjktcV) for the screens.

---

## 1. Goals and non-goals

**Goals**

1. One Postgres database is the single source of truth for clients, employees, roles, templates, cases, documents and reminders.
2. An MCP server exposes that data as tools, so Claude (or any MCP client) can read and update it with a token.
3. A React dashboard shows the same data as the mockup: overview, case board and detail, clients, reminders, team and roles, templates, settings.
4. Both surfaces share one domain layer, so permissions, validation and the audit log behave identically whether a person clicks or an assistant calls a tool.
5. Identification is a token for now. It is stored hashed, created manually, and works as the dashboard login and the MCP bearer credential.

**Non-goals for this MVP**

- Proper user accounts, passwords, OAuth or SSO. The token model is built so these can be added later without changing the data model.
- Server-side AI pipelines. In the MVP the intelligence comes from the MCP client, which reads documents and writes results back through tools (section 7.5).
- PDF form pre-fill, automatic message delivery, client portal, payments, lead generation, multiple offices, Thai UI. All are listed in the roadmap (section 13).

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere, `strict` on | One language across web, server, MCP and scripts |
| Runtime | Node.js 24 LTS | Current LTS |
| Monorepo | pnpm workspaces + Turborepo | Fast installs, cached builds and tests per package |
| Database | PostgreSQL 17+ | Relational data, JSON where shape varies, array columns |
| ORM and migrations | Prisma | Already in the team's tooling; typed client; migration history in git |
| Validation | Zod | One schema per input, reused by the API, the MCP tools and the forms |
| Server | Express 5 | The MCP TypeScript SDK's Streamable HTTP examples and tRPC's server adapter both target Express, so both mount in one process |
| Dashboard API | tRPC v11 | End-to-end types between `apps/web` and the server with no code generation |
| MCP | `@modelcontextprotocol/sdk` (TypeScript), Streamable HTTP transport | Official SDK, remote transport usable by Claude Code and other clients |
| Background jobs | pg-boss | Queue and cron on the same Postgres, so no Redis to run |
| File storage | Railway Bucket in Singapore (`sin`), Adobe S3Mock locally (MinIO no longer publishes Docker images) | S3-compatible, private, free egress and API calls; presigned URLs keep files off the server |
| Web app | React 19 + Vite, TanStack Router, TanStack Query (through the tRPC client) | Typed routes, cached server state |
| Styling | Tailwind CSS v4 with CSS variables for theme tokens, Radix primitives for dialogs and menus | Theme colour changes at runtime; accessible primitives |
| Lint and format | Biome | One fast tool for both |
| Tests | Vitest, real Postgres in CI, Playwright for a smoke flow | Domain logic tested against the real database |
| Hosting | Railway, Singapore region, defined in `.railway/railway.ts` (section 12) | Already in use; closest region to Thailand; infrastructure reviewed in pull requests |

---

## 3. Repository layout

```
ezvisa-mono/
├─ apps/
│  ├─ server/          Express app: /auth, /trpc, /mcp, /health, serves the web build in production
│  └─ web/             React dashboard (Vite)
├─ packages/
│  ├─ db/              Prisma schema, migrations, seed, token scripts, exported client
│  ├─ core/            Domain services, permission checks, Zod schemas, audit log. No HTTP.
│  ├─ mcp/             MCP server definition: tool registrations that call core
│  ├─ ui/              Theme engine (accent → tokens) and shared React components
│  └─ config/          Shared tsconfig and Biome presets
├─ docs/
├─ docker-compose.yml  Postgres + S3Mock for local development
├─ turbo.json
└─ pnpm-workspace.yaml
```

**Dependency rule.** `web` imports types from `server` (the tRPC router type) and components from `ui`. `server` imports `core`, `mcp` and `db`. `mcp` imports `core`. `core` imports `db`. Nothing imports `apps/*` at runtime.

**Package names:** `@ezvisa/server`, `@ezvisa/web`, `@ezvisa/db`, `@ezvisa/core`, `@ezvisa/mcp`, `@ezvisa/ui`, `@ezvisa/config`.

---

## 4. Data model

### 4.1 Conventions

- Primary keys are UUIDv7 (`uuid(7)`), so they sort by creation time.
- Timestamps are `timestamptz` in UTC. Business dates (permission to stay, 90-day report, case due date) are `date` columns, interpreted in `Asia/Bangkok`.
- Clients and documents are soft-deleted with `deletedAt`. A retention job hard-deletes them later (section 9).
- Every write goes through `core`, which records an `AuditLog` row in the same transaction.
- A case's display number is `EZ-` followed by an integer from a sequence starting at 1000.

### 4.2 Prisma schema (draft)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum EmployeeKind {
  HUMAN
  ASSISTANT
}

enum Channel {
  LINE
  WHATSAPP
  MESSENGER
  EMAIL
  PHONE
}

enum CaseStage {
  NEW
  COLLECTING
  DRAFTING
  VALIDATION
  SUBMISSION
  DONE
  CANCELLED
}

enum CaseOutcome {
  APPROVED
  REJECTED
  MORE_DOCUMENTS
  WITHDRAWN
}

enum ItemKind {
  DOCUMENT
  FORM
  PAYMENT
  OTHER
}

enum ItemStatus {
  MISSING
  RECEIVED
  VERIFIED
  FLAGGED
  WAIVED
}

enum FileKind {
  PDF_FORM
  LETTER
  REFERENCE
}

enum VersionStatus {
  DRAFT
  PUBLISHED
  RETIRED
}

enum DeadlineKind {
  STAY_ENDS
  REPORT_DUE
}

enum ReminderStatus {
  SCHEDULED
  DUE
  SENT
  SKIPPED
  CANCELLED
}

enum Via {
  DASHBOARD
  MCP
  SYSTEM
}

model Role {
  id          String     @id @default(uuid(7)) @db.Uuid
  name        String     @unique
  description String?
  permissions Json       // shape in section 5.4
  isSystem    Boolean    @default(false)
  employees   Employee[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

model Employee {
  id        String       @id @default(uuid(7)) @db.Uuid
  name      String
  email     String?      @unique
  phone     String?
  kind      EmployeeKind @default(HUMAN)
  roleId    String       @db.Uuid
  role      Role         @relation(fields: [roleId], references: [id])
  active    Boolean      @default(true)
  tokens    ApiToken[]
  assigned  Case[]       @relation("assignee")
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
}

model ApiToken {
  id         String    @id @default(uuid(7)) @db.Uuid
  employeeId String    @db.Uuid
  employee   Employee  @relation(fields: [employeeId], references: [id])
  label      String    // "Namtarn laptop", "Claude Code"
  hash       String    @unique // sha256 hex of the full token
  last4      String
  expiresAt  DateTime?
  revokedAt  DateTime?
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  sessions   Session[]
}

model Session {
  id        String   @id // 32 random bytes, base64url
  tokenId   String   @db.Uuid
  token     ApiToken @relation(fields: [tokenId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model Client {
  id            String     @id @default(uuid(7)) @db.Uuid
  fullName      String
  nationality   String     // ISO 3166-1 alpha-2
  passportNo    String?
  dateOfBirth   DateTime?  @db.Date
  email         String?
  phone         String?
  channel       Channel    @default(LINE)
  channelHandle String?
  address       String?
  visaType      String?    // free text for now: "Non-O retirement", "DTV"
  stayUntil     DateTime?  @db.Date
  nextReportDue DateTime?  @db.Date
  notes         String?
  consentAt     DateTime?  // PDPA consent captured at intake
  cases         Case[]
  documents     Document[]
  reminders     Reminder[]
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  deletedAt     DateTime?

  @@index([stayUntil])
  @@index([nextReportDue])
}

model Template {
  id           String            @id @default(uuid(7)) @db.Uuid
  slug         String            @unique // "retirement-extension"
  name         String
  description  String?
  office       String            @default("Chiang Mai Immigration")
  deadlineKind DeadlineKind?     // which client deadline a case of this type resolves
  archivedAt   DateTime?
  versions     TemplateVersion[]
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
}

model TemplateVersion {
  id            String         @id @default(uuid(7)) @db.Uuid
  templateId    String         @db.Uuid
  template      Template       @relation(fields: [templateId], references: [id])
  version       Int
  status        VersionStatus  @default(DRAFT)
  knownFailures String[]
  notes         String?
  publishedAt   DateTime?
  publishedById String?        @db.Uuid
  items         TemplateItem[]
  files         TemplateFile[]
  cases         Case[]
  createdAt     DateTime       @default(now())

  @@unique([templateId, version])
}

model TemplateItem {
  id          String          @id @default(uuid(7)) @db.Uuid
  versionId   String          @db.Uuid
  version     TemplateVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  position    Int
  label       String
  description String?
  kind        ItemKind        @default(DOCUMENT)
  required    Boolean         @default(true)
  rules       Json?           // e.g. { "maxAgeDays": 7 } for a bank letter
  formFileId  String?         @db.Uuid
  formFile    TemplateFile?   @relation(fields: [formFileId], references: [id])
}

model TemplateFile {
  id         String          @id @default(uuid(7)) @db.Uuid
  versionId  String          @db.Uuid
  version    TemplateVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  name       String
  kind       FileKind
  storageKey String          @unique
  mimeType   String
  sizeBytes  Int
  fieldMap   Json?           // reserved for form pre-fill (roadmap)
  items      TemplateItem[]
}

model Case {
  id                String          @id @default(uuid(7)) @db.Uuid
  number            Int             @unique @default(autoincrement()) // sequence starts at 1000
  clientId          String          @db.Uuid
  client            Client          @relation(fields: [clientId], references: [id])
  templateVersionId String          @db.Uuid
  templateVersion   TemplateVersion @relation(fields: [templateVersionId], references: [id])
  stage             CaseStage       @default(NEW)
  outcome           CaseOutcome?
  assigneeId        String?         @db.Uuid
  assignee          Employee?       @relation("assignee", fields: [assigneeId], references: [id])
  dueDate           DateTime?       @db.Date
  notes             String?
  items             CaseItem[]
  documents         Document[]
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  closedAt          DateTime?

  @@index([stage])
  @@index([assigneeId])
  @@index([clientId])
}

model CaseItem {
  id             String        @id @default(uuid(7)) @db.Uuid
  caseId         String        @db.Uuid
  case           Case          @relation(fields: [caseId], references: [id], onDelete: Cascade)
  templateItemId String?       @db.Uuid
  position       Int
  label          String
  kind           ItemKind
  required       Boolean
  status         ItemStatus    @default(MISSING)
  note           String?       // the reason, mandatory when FLAGGED or WAIVED
  flaggedByKind  EmployeeKind?
  updatedById    String?       @db.Uuid
  documents      Document[]
  updatedAt      DateTime      @updatedAt
}

model Document {
  id           String    @id @default(uuid(7)) @db.Uuid
  clientId     String    @db.Uuid
  client       Client    @relation(fields: [clientId], references: [id])
  caseId       String?   @db.Uuid
  case         Case?     @relation(fields: [caseId], references: [id])
  caseItemId   String?   @db.Uuid
  caseItem     CaseItem? @relation(fields: [caseItemId], references: [id])
  filename     String
  mimeType     String
  sizeBytes    Int
  sha256       String
  storageKey   String    @unique
  extracted    Json?     // fields an assistant read from the document
  uploadedById String?   @db.Uuid
  createdAt    DateTime  @default(now())
  deletedAt    DateTime?
}

model ReminderRule {
  id              String       @id @default(uuid(7)) @db.Uuid
  kind            DeadlineKind @unique
  offsetsDays     Int[]        // STAY_ENDS [60,30,14,7], REPORT_DUE [14,7,2]
  messageTemplate String       // variables in section 8
  active          Boolean      @default(true)
  updatedAt       DateTime     @updatedAt
}

model Reminder {
  id         String         @id @default(uuid(7)) @db.Uuid
  clientId   String         @db.Uuid
  client     Client         @relation(fields: [clientId], references: [id])
  kind       DeadlineKind
  deadline   DateTime       @db.Date
  offsetDays Int
  sendOn     DateTime       @db.Date
  status     ReminderStatus @default(SCHEDULED)
  channel    Channel
  message    String?        // rendered text, frozen when sent
  sentAt     DateTime?
  sentById   String?        @db.Uuid
  createdAt  DateTime       @default(now())

  @@unique([clientId, kind, deadline, offsetDays])
  @@index([status, sendOn])
}

model Setting {
  key       String   @id // "theme.accent"
  value     Json
  updatedAt DateTime @updatedAt
}

model AuditLog {
  id       BigInt   @id @default(autoincrement())
  at       DateTime @default(now())
  actorId  String?  @db.Uuid
  via      Via
  action   String   // "case.stage_changed", "document.read"
  entity   String
  entityId String
  before   Json?
  after    Json?

  @@index([entity, entityId])
  @@index([at])
}
```

### 4.3 Rules the schema alone does not enforce

These live in `core` and are covered by tests.

1. **Opening a case copies the template.** `create_case` copies every item of the template's latest PUBLISHED version into `CaseItem` rows. Later template edits never change open cases.
2. **Only humans verify.** Setting a case item to `VERIFIED` requires a `HUMAN` actor. An assistant can set `RECEIVED` or `FLAGGED`, and a flag needs a note.
3. **Stage guards.**
   - Moving to `VALIDATION` requires every required item to be `RECEIVED`, `VERIFIED` or `WAIVED`.
   - Moving to `SUBMISSION` requires the `approvePacks` permission, a human actor, no `FLAGGED` item, and every required item `VERIFIED` or `WAIVED`.
   - Moving to `DONE` requires the `markSubmitted` permission and an outcome.
   - Any stage can move to `CANCELLED` with a note. A closed case cannot be reopened in the MVP.
4. **Templates are versioned.** Edits apply to a DRAFT version. Publishing makes it current and retires the previous PUBLISHED version. Only one DRAFT per template exists at a time.
5. **Deadlines drive reminders.** Changing a client's `stayUntil` or `nextReportDue` cancels pending reminders for the old date and schedules new ones.

---

## 5. Identification and permissions

### 5.1 Tokens

- **Format:** `ezv_live_` followed by 32 random bytes in base62, about 52 characters in total.
- **Storage:** only the SHA-256 hex digest and the last four characters. The plain token is shown once at creation.
- **Creation in the MVP:** manual, as requested. Two ways:

```bash
pnpm --filter @ezvisa/db token:create --employee namtarn@example.com --label "Namtarn laptop"
```

```sql
-- Equivalent raw SQL, with a token you generated yourself
INSERT INTO "ApiToken" (id, "employeeId", label, hash, last4)
VALUES (gen_random_uuid(), '<employee uuid>', 'Namtarn laptop',
        encode(sha256('ezv_live_<your token>'::bytea), 'hex'), '<last 4 chars>');
```

- **Revocation:** setting `revokedAt` blocks the token on its next request and deletes its dashboard sessions. The `token:revoke` script does both.
- **Usage tracking:** `lastUsedAt` is updated at most once per minute per token.

### 5.2 Dashboard sign-in

1. The sign-in page posts `{ token }` to `POST /auth/login`.
2. The server hashes the token, finds an active, unrevoked, unexpired `ApiToken` whose employee is active, and creates a `Session`.
3. It sets the `ezv_session` cookie: httpOnly, Secure, SameSite=Lax, 30 days.
4. `POST /auth/logout` deletes the session. `GET /auth/me` returns the employee, role and permissions.
5. Login attempts are rate-limited to 10 per minute per IP address.

The raw token is never stored in the browser. Replacing tokens with real accounts later only changes how a `Session` is created.

### 5.3 MCP authentication

Every MCP request carries `Authorization: Bearer ezv_live_…`. The server resolves the token to an `Actor` with one indexed lookup per request and no cache, so a revoked token is refused on its very next request. A missing or invalid token gets HTTP 401 before any MCP processing.

Static bearer tokens work with clients that let you set headers, such as Claude Code:

```bash
claude mcp add --transport http ezvisa https://<your-domain>/mcp --header "Authorization: Bearer ezv_live_<token>"
```

Some clients, such as hosted connectors, expect the MCP OAuth flow instead. Supporting them is part of the "proper identification" work after the MVP.

### 5.4 Permissions

```ts
type Level = "none" | "view" | "edit" | "full"; // edit = create + update, full = edit + delete

type Permissions = {
  clients: Level;
  cases: Level;
  documents: Level;
  templates: Level;
  reminders: Level;
  team: Level;       // employees, roles, tokens
  settings: Level;
  approvePacks: boolean;
  markSubmitted: boolean;
};
```

Seeded roles, matching the mockup:

| Role | Clients | Cases | Documents | Templates | Reminders | Team | Settings | Approve packs | Mark submitted |
|---|---|---|---|---|---|---|---|---|---|
| Owner | full | full | full | full | full | full | full | yes | yes |
| Senior agent | full | full | full | edit | edit | view | view | yes | yes |
| Validator | edit | edit | edit | view | edit | none | none | yes | no |
| Runner | view | view | view | view | view | none | none | no | yes |
| Assistant (MCP) | edit | edit | edit | view | view | none | none | no | no |

A Runner only views cases. The `markSubmitted` permission on its own lets a Runner move a case from `SUBMISSION` to `DONE`, record the outcome, and upload the receipt. Every service function starts with a `ctx.require(resource, level)` call. The permission matrix gets one test per role and tool.

---

## 6. Server

### 6.1 Endpoints

| Path | Purpose |
|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Dashboard session |
| `/trpc/*` | Dashboard API, session cookie required |
| `POST /mcp` | MCP Streamable HTTP endpoint, bearer token required |
| `GET /health` | Liveness and database check for Railway |
| `/*` | Built web app (production only) |

### 6.2 Request context

Both `/trpc` and `/mcp` build the same `Context`:

```ts
type Actor = { employeeId: string; kind: "HUMAN" | "ASSISTANT"; permissions: Permissions; tokenId: string };
type Context = { actor: Actor; via: "DASHBOARD" | "MCP" | "SYSTEM"; db: PrismaClient; storage: Storage; now: () => Date };
```

`core` services take `(ctx, input)`, validate `input` with Zod, check permissions, run in a transaction, and write the audit log. The tRPC routers and the MCP tools are thin wrappers over these services.

### 6.3 Errors

`core` throws typed errors: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `CONFLICT`, `GUARD_FAILED`. tRPC maps them to its error codes. MCP maps them to tool results with `isError: true` and a message the model can act on, such as "Cannot move EZ-1043 to SUBMISSION: 'Bank letter' is FLAGGED".

### 6.4 Files

- Uploads from the dashboard use presigned PUT URLs valid for 10 minutes. The browser uploads straight to the bucket, then confirms. The server checks size and type, then stores the SHA-256.
- Downloads use presigned GET URLs valid for 5 minutes. Every read is written to the audit log.
- On Railway, bucket egress is free but service egress is billed. Going direct to the bucket in both directions keeps file traffic off the server's bill.
- The S3 client uses the bucket's endpoint, region `auto` and virtual-hosted URLs. It sends no server-side-encryption headers, which Railway buckets do not support. Railway encrypts objects at rest.
- Object keys are never reused, so a file is never overwritten. This matters because Railway buckets have no versioning.
- Size limit: 20 MB per file. Allowed types: PDF, JPEG, PNG, HEIC, WebP, DOCX.
- Keys follow `clients/<clientId>/<documentId>/<filename>` and `templates/<templateId>/<versionId>/<fileId>/<filename>`.

---

## 7. MCP server

### 7.1 Transport and metadata

- Streamable HTTP at `POST /mcp`, in stateless mode: no MCP session, one server instance per request, JSON responses.
- Server name `ezvisa`, version from `package.json`.
- The `instructions` field tells the model the house rules: dates are Bangkok dates in `YYYY-MM-DD`; it must never claim an item is verified; every flag needs a reason; it must confirm the client by name and date of birth before writing.

### 7.2 Tool conventions

- Names are `verb_noun` in snake_case. This fits the character rules of every major client.
- Inputs are Zod schemas with a `.describe()` on every field. They are the same schemas `core` uses.
- Results return the JSON as text, for clients that only read text, plus the same object as `structuredContent`.
- Each token only sees the tools its role could ever use: an assistant is not shown team administration or delete tools. Finer rules, such as approving a pack, still come back as tool errors.
- Annotations: list and get tools set `readOnlyHint: true`. Delete, revoke and archive tools set `destructiveHint: true`.
- List tools take `limit` (default 25, max 100) and `cursor`, and return `nextCursor`.
- A permission failure is a tool error, not a protocol error, so the model sees why.

### 7.3 Tools

| Area | Tools | Needs |
|---|---|---|
| Session | `whoami` | any token |
| Clients | `list_clients` (search, segment, `expiring_within_days`), `get_client` (with cases, documents, upcoming deadlines), `create_client`, `update_client`, `delete_client` | clients: view / edit / full |
| Employees | `list_employees`, `get_employee`, `create_employee`, `update_employee`, `deactivate_employee` | team |
| Roles | `list_roles`, `get_role`, `create_role`, `update_role`, `delete_role` (only when no employee uses it) | team |
| Tokens | `list_tokens`, `revoke_token` | team: full |
| Templates | `list_templates`, `get_template` (version optional), `create_template`, `update_template`, `add_template_item`, `update_template_item`, `remove_template_item`, `reorder_template_items`, `attach_template_file`, `remove_template_file`, `publish_template_version`, `archive_template` | templates |
| Cases | `list_cases` (stage, assignee, client, `due_before`), `get_case`, `create_case`, `update_case` (assignee, due date, notes), `move_case_stage`, `close_case` (outcome) | cases, plus the stage guards |
| Case items | `update_case_item` (status, note, linked documents) | cases: edit |
| Documents | `list_documents`, `get_document`, `read_document`, `upload_document`, `create_document_upload`, `confirm_document_upload`, `update_document` (fields read from it), `delete_document` | documents |
| Reminders | `list_deadlines` (`within_days`), `list_reminders` (status), `mark_reminder_sent`, `skip_reminder`, `get_reminder_rules`, `update_reminder_rule` | reminders |

Token creation is deliberately not an MCP tool in the MVP. A leaked assistant token must not be able to mint new tokens.

### 7.4 Documents over MCP

- `upload_document` takes `content_base64` for files up to 10 MB. That covers photos and scans an assistant receives in a conversation.
- `create_document_upload` returns a presigned PUT URL for larger files, followed by `confirm_document_upload`.
- `read_document` returns the file itself as MCP content: an `image` block for images, and an embedded resource with `application/pdf` for PDFs. PDF support varies by client, so the result also includes `get_document` metadata and a 5-minute download URL. Every read is audited.

### 7.5 The AI loop in the MVP

The server contains no model calls. The assistant does the reading and the writing through tools:

1. A staff member asks Claude, connected through MCP: "Check Hans Becker's new uploads against his retirement checklist".
2. Claude calls `get_case`, then `read_document` on each new file.
3. It calls `update_client` with extracted fields such as passport number and date of birth.
4. It calls `update_case_item` to mark items `RECEIVED`, or `FLAGGED` with a reason, such as "photo background is grey".
5. A validator opens the case in the dashboard, checks the flagged items, and marks them `VERIFIED`. Claude cannot do that step.

Server-side extraction and pre-fill come later and reuse the same services (section 13).

---

## 8. Reminders

- **Rules:** one `ReminderRule` per deadline kind, seeded as `STAY_ENDS: [60, 30, 14, 7]` and `REPORT_DUE: [14, 7, 2]`. They are editable from Settings or `update_reminder_rule`, by roles with full reminder access.
- **Daily job:** runs at 08:00 Asia/Bangkok through pg-boss cron.
  1. For each client whose `stayUntil` falls within the next 60 days, or whose `nextReportDue` falls within the next 30, it upserts one `Reminder` per offset with `sendOn = deadline − offset`.
  2. It cancels pending reminders whose deadline no longer matches the client.
  3. It marks `SCHEDULED` reminders with `sendOn ≤ today` as `DUE`.
- **Before the job exists (M1 and M2):** `list_reminders` runs the same idempotent sync on demand, so reminders work as soon as the MCP server does. When a deadline is first learned with send dates already past, one catch-up reminder is created, unless a scheduled one goes out within three days.
- **Linking to cases:** a deadline counts as "case open" when the client has an open case whose template `deadlineKind` matches. The dashboard then offers "Open case" instead of "Send now".
- **Sending in the MVP is manual.** "Send now" renders the message, copies it to the clipboard, and marks the reminder `SENT` with the text and the sender. Staff paste it into LINE or WhatsApp. Automatic delivery is on the roadmap.
- **Message variables:** `{first_name}`, `{deadline}` (for example "27 Oct"), `{days_left}`, `{agent_name}`.

Default stay message:

> Hi {first_name}, your permission to stay in Thailand ends on {deadline}, in {days_left} days. Reply here and we will start your extension. {agent_name}, EzVisa

---

## 9. Security and PDPA

| Topic | Rule |
|---|---|
| Secrets | Tokens hashed; session ids random; no secrets in logs; environment variables only |
| Transport | HTTPS only in production; HSTS |
| Storage | Private Railway bucket (public buckets do not exist on Railway), encrypted at rest, presigned URLs of 5 to 10 minutes |
| Database access | Postgres reachable only over Railway's private network; no public TCP proxy; admin access through the Railway CLI |
| Logging | Request logs carry ids, never names, passport numbers or file contents |
| Audit | Every write and every document read goes to `AuditLog`, including MCP calls with the token id |
| Consent | `Client.consentAt` must be set before documents can be uploaded for that client |
| Retention | A nightly job hard-deletes documents 12 months after their case closed, unless the client still has an open case or a future deadline. The period is a setting. |
| Access requests | `get_client` with `include_all` exports everything held on a client, to answer PDPA access requests |
| Rate limits | Login 10 per minute per IP; MCP 120 requests per minute per token |
| Backups | Postgres point-in-time recovery, plus a nightly copy of new documents to a second bucket (section 12.6) |

---

## 10. Dashboard

### 10.1 Screens

Each screen matches a frame of the mockup.

| Route | Screen | Main data |
|---|---|---|
| `/login` | Sign in with a token | `POST /auth/login` |
| `/` | Overview: counters, pipeline, needs attention, deadlines, activity | `dashboard.overview` |
| `/cases` | Case board by stage | `cases.list` |
| `/cases/:number` | Case detail: stage tracker, checklist, documents, forms, actions | `cases.get`, `caseItems.update`, `cases.moveStage` |
| `/clients` | Client table with filters | `clients.list` |
| `/clients/:id` | Client profile, deadlines, documents, cases (not in the mockup yet) | `clients.get` |
| `/reminders` | Upcoming expiries, schedule, message preview | `reminders.list`, `reminders.markSent` |
| `/team` | People, roles and permission matrix | `employees.list`, `roles.list` |
| `/templates` | Template cards | `templates.list` |
| `/templates/:slug` | Checklist, forms and files, known failures, draft and publish | `templates.get`, template mutations |
| `/settings` | Theme colour, tokens (list and revoke), MCP connection details | `settings.*`, `tokens.*` |

### 10.2 Behaviour

- Data loads through tRPC with TanStack Query. Checklist toggles and stage moves update optimistically and roll back on error.
- Actions the role cannot perform are hidden. A forbidden result from the server shows a toast.
- Dates display as "6 Oct 2026". Relative labels ("in 5 days") are computed in Asia/Bangkok.
- Layouts work from 360 px wide, so runners can use the dashboard on a phone at the immigration office.

### 10.3 Theme

- `packages/ui/theme.ts` ports the mockup's theme function. It takes one accent colour and derives the background, surfaces, lines, tints and a darkened text colour that keeps at least 4.5:1 contrast.
- The result is written as CSS variables on `:root`, which Tailwind reads through `@theme`.
- The organisation accent is stored in `Setting` under `theme.accent`, with Sakura pink `#EC5F9E` as the default. Each person can override it in their browser.
- Fonts are Fredoka for headings and Nunito for body text.

---

## 11. Development, testing and deployment

### 11.1 Local setup

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:seed` creates the five roles, Namtarn as owner, the reminder rules, the theme setting, and sample templates. It also prints a development token. `pnpm dev` runs the server on port 3000 and Vite on port 5173 with a proxy to the server.

### 11.2 Environment variables

| Variable | Used by | On Railway |
|---|---|---|
| `DATABASE_URL` | db, server | Reference to the Postgres service's private URL |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | server | References to the `documents` bucket's variables |
| `BACKUP_S3_*` (same five) | server, backup job | References to the `documents-backup` bucket |
| `APP_URL` | server (cookies, links in messages) | The custom domain in production, the Railway domain elsewhere |
| `SEED_OWNER_TOKEN` | seed script, non-production only | Shared variable on PR environments |
| `NODE_ENV`, `PORT` | server | `PORT` is injected by Railway |

Locally, the same names live in `.env`, pointing at the docker compose Postgres and S3Mock. S3Mock needs path-style URLs, hence `S3_FORCE_PATH_STYLE=true` locally.

### 11.3 Tests

| Layer | What | How |
|---|---|---|
| core | Every service, guard and audit write | Vitest against a real Postgres, one schema per test worker |
| permissions | Each role against each tool | Generated table test |
| mcp | Tool listing, schemas, a full case flow | MCP SDK client against the server in process |
| web | Sign in, open a case, verify an item, move the stage | Playwright smoke test |

### 11.4 Continuous integration

GitHub Actions runs on every pull request: install, typecheck, Biome, tests against a Postgres service container, and build. Deployment is covered in section 12.

---

## 12. Deployment on Railway

Everything runs in one Railway project in the Singapore region. The project is described in `.railway/railway.ts`, Railway's Infrastructure as Code file. Railway's older per-service `railway.json` and `railway.toml` files are deprecated: new services cannot use them, and Railway stops reading existing ones on 1 December 2026. This project never uses them.

### 12.1 Resources

| Resource | Type | Region | Role |
|---|---|---|---|
| `server` | Service built from the GitHub repository | `asia-southeast1-eqsg3a` (Singapore) | Serves `/auth`, `/trpc`, `/mcp`, `/health` and the web build. One replica in the MVP. |
| `postgres` | Railway Postgres | Singapore | Private network only; point-in-time recovery on |
| `documents` | Railway Bucket | `sin` (Singapore) | Client documents and template files |
| `documents-backup` | Railway Bucket | `sin` (Singapore) | Nightly copy of new objects and weekly database dumps |

**Why one service.** The dashboard and the API share one origin, so the session cookie needs no cross-origin setup. It is also the smallest bill. The web build can move to its own static service later without code changes.

### 12.2 `.railway/railway.ts` (draft)

```ts
import { bucket, defineRailway, github, postgres, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const prod = ctx.environment === "production";

  const db = postgres("postgres");
  const documents = bucket("documents", { region: "sin" });
  const backup = bucket("documents-backup", { region: "sin" });

  const server = service("server", {
    source: github("<owner>/ezvisa-mono", { branch: "main" }),
    build: "pnpm turbo run build --filter=@ezvisa/server... --filter=@ezvisa/web...",
    preDeploy: "pnpm --filter @ezvisa/db migrate:deploy",
    start: "pnpm --filter @ezvisa/server start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    domains: prod ? ["app.<your-domain>"] : [],
    env: {
      NODE_ENV: "production",
      APP_URL: prod ? "https://app.<your-domain>" : "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      DATABASE_URL: db.env.DATABASE_URL,
      S3_ENDPOINT: "${{documents.ENDPOINT}}",
      S3_REGION: "${{documents.REGION}}",
      S3_BUCKET: "${{documents.BUCKET}}",
      S3_ACCESS_KEY_ID: "${{documents.ACCESS_KEY_ID}}",
      S3_SECRET_ACCESS_KEY: "${{documents.SECRET_ACCESS_KEY}}",
      BACKUP_S3_ENDPOINT: "${{documents-backup.ENDPOINT}}",
      BACKUP_S3_REGION: "${{documents-backup.REGION}}",
      BACKUP_S3_BUCKET: "${{documents-backup.BUCKET}}",
      BACKUP_S3_ACCESS_KEY_ID: "${{documents-backup.ACCESS_KEY_ID}}",
      BACKUP_S3_SECRET_ACCESS_KEY: "${{documents-backup.SECRET_ACCESS_KEY}}",
    },
  });

  return project("ezvisa", { resources: [db, documents, backup, server] });
});
```

Two points to confirm with `railway config plan` in M0. First, the bucket variables are written with Railway's `${{resource.VARIABLE}}` reference syntax. Second, the Postgres region is set when the database is first provisioned, since the `postgres()` helper takes no region.

### 12.3 Build and runtime

- **Shared monorepo.** The service has no root directory, because the build needs the workspace root. Railway's builder detects pnpm, and the root `package.json` pins `packageManager` (pnpm) and `engines.node` (24).
- **Watch paths.** The service redeploys only when `apps/**`, `packages/**` or `pnpm-lock.yaml` change, so documentation edits do not trigger a deploy. This is set in the service settings.
- **Migrations.** The pre-deploy command runs `prisma migrate deploy` over the private network. If it fails, the deploy stops and the previous version keeps serving. The Prisma CLI is therefore a runtime dependency of `@ezvisa/db`, not a dev dependency.
- **Backward-compatible migrations.** The old version serves traffic until the new one passes its health check. Every migration must therefore work with both versions: add columns first, remove them in a later release.
- **Health check.** `/health` returns 200 only when the database answers. Railway switches traffic to a new deployment only after it passes.
- **Database connection.** The server uses the private `DATABASE_URL`. The database has no public TCP proxy, and staff reach it with `railway connect postgres` when needed.
- **Buckets** are reachable only over the public network. That is why browsers upload and download directly with presigned URLs.
- **Scheduled jobs** run inside the server through pg-boss: reminders at 08:00, the bucket backup at 02:00 and retention at 03:00, all Asia/Bangkok. If the server ever runs more than one replica, pg-boss still runs each job once.
- **Logs** are structured JSON written to standard output, read in Railway's log explorer. They never contain names, passport numbers or file contents.

### 12.4 Environments

| Environment | Source | Data | Notes |
|---|---|---|---|
| Local | Developer machine | docker compose Postgres and S3Mock, seeded | `pnpm dev` |
| PR environments | Each pull request | Their own Postgres and bucket instances, seeded with sample data | Railway gives every environment separate bucket instances and credentials, so previews never touch client files |
| `production` | `main` branch | Real client data | Custom domain, point-in-time recovery, no seed |

- In production the seed creates only roles, reminder rules, settings and the owner named by `SEED_OWNER_EMAIL`. It never creates tokens or sample data there.
- In PR environments the seed creates the owner token from `SEED_OWNER_TOKEN`, so testers can sign in without a token appearing in logs.
- Sealed variables are not copied into PR environments by Railway. Nothing the previews need may be sealed.
- Production deploys only after CI passes on `main`, using Railway's wait-for-CI option.

### 12.5 Changing infrastructure

1. Edit `.railway/railway.ts` in a pull request. The `railway` package is a root dev dependency.
2. The `railwayapp/config` GitHub Action posts the plan as a comment on the pull request, with destructive changes marked.
3. Merging applies exactly the reviewed plan, using a project token scoped to production and stored as `RAILWAY_TOKEN`.
4. Locally, `railway config plan` previews the same diff. Applying by hand is reserved for the first setup in M0.

### 12.6 Backups and recovery

| What | How | Window |
|---|---|---|
| Postgres | Railway point-in-time recovery: continuous WAL archiving with weekly full and daily differential backups | About 4 weeks, to any second |
| Postgres, portable copy | Weekly `pg_dump` written to `documents-backup` | Last 8 weeks |
| Documents | Nightly job copies the previous day's new objects to `documents-backup`. Railway buckets have no native backups or versioning. | Same retention as the source |
| Accidental deletes | Documents are soft-deleted, and objects stay in the bucket until the retention job runs | Until retention |

The retention job deletes expired documents from both buckets, so backups never outlive the PDPA retention period. Before go-live, one recovery drill restores the database to a point in time in a separate environment and starts the server against it.

### 12.7 Cost at MVP scale

Buckets cost USD 0.015 per GB-month, with free egress and free API calls. Sixty cases a month at about 25 files of 1.5 MB each adds roughly 2 GB a month. Storage therefore stays well under a dollar a month in the first year. Compute and Postgres are billed by usage, and one small Node service plus a small database is the whole footprint.

---

## 13. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold and Railway | The repo builds in CI. Local Postgres and S3Mock run. `.railway/railway.ts` is applied, creating the server, Postgres and both buckets in Singapore. `/health` answers on the Railway domain, migrations run in the pre-deploy step, and PR environments come up seeded. |
| M1 | Data, tokens and MCP | Schema migrated and seeded. Tokens created by script. Every tool in section 7.3 works from Claude Code against production, with permission and audit tests green. |
| M2 | Dashboard, read side | Token sign-in. Overview, cases, case detail, clients, team and templates show live data, styled like the mockup. |
| M3 | Dashboard, write side, and reminders | Checklist updates, stage moves, uploads, template editing and publishing, the reminder job, the Reminders screen with manual send, theme and token settings. Namtarn runs her real cases on it. |
| M4 | Next | PDF pre-fill from `fieldMap`, automatic reminder delivery (email, then WhatsApp through Twilio, then the LINE Messaging API), server-side document extraction, client portal, OAuth for hosted MCP connectors. |

M1 comes before the dashboard on purpose. Once it ships, Namtarn's data can be entered and queried through Claude while the screens are being built.

---

## 14. Open questions

1. **Domain.** Which domain hosts the dashboard and the MCP endpoint? The spec assumes `app.<your-domain>`.
2. **Client identity check.** Is name plus date of birth enough before the assistant writes to a client, or should it be passport number?
3. **90-day reports as cases.** Should every 90-day report be a case, or only a reminder plus a one-click "done" record?
4. **Template seed.** Which three templates go in first? The mockup assumes retirement extension, DTV 180-day extension and 90-day report.
5. **Language.** Do validators and runners need a Thai interface in M2, or is English enough at the start?
6. **Retention.** Does 12 months after case close match what Namtarn and her lawyer want for PDPA?
