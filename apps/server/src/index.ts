import { fileURLToPath } from "node:url";
import {
  ChatAgents,
  chatFromEnv,
  chatModelsFromEnv,
  FormPreparer,
  formAiFromEnv,
  LocalDiskStorage,
  loadRootEnv,
  S3Storage,
  type Storage,
  storageFromEnv,
  vapidSubject,
  WebPushSender,
} from "@ezvisa/core";
import { createDb } from "@ezvisa/db";
import { mcpToolbox } from "@ezvisa/mcp";
import { createApp } from "./app.js";

loadRootEnv();

const db = createDb();
const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
const production = process.env.NODE_ENV === "production";
// src/index.ts and dist/index.js both resolve to apps/web/dist.
const webDir = fileURLToPath(new URL("../../web/dist", import.meta.url));

const port = Number(process.env.PORT ?? 3000);

// Production needs a bucket. In development, files go to .data/storage when S3_* is unset.
let storage: Storage | null = storageFromEnv();
if (!storage && !production) {
  const root = fileURLToPath(new URL("../../../.data/storage", import.meta.url));
  storage = new LocalDiskStorage(root, `http://localhost:${port}`);
  console.log(JSON.stringify({ level: "info", msg: "documents stored on disk", root }));
} else if (!storage) {
  console.log(JSON.stringify({ level: "warn", msg: "S3_* not set: document storage is disabled" }));
}

// Browsers upload straight to the bucket, so it must accept PUTs from the dashboard.
const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
const uploadOrigins = [
  ...new Set(
    [process.env.APP_URL ?? (production ? undefined : "http://localhost:5173")]
      .concat(publicDomain ? [`https://${publicDomain}`] : [])
      .filter((origin): origin is string => Boolean(origin))
      .map((origin) => origin.replace(/\/$/, "")),
  ),
];
if (storage instanceof S3Storage && uploadOrigins.length > 0) {
  storage
    .allowBrowserUploads(uploadOrigins)
    .then(() =>
      console.log(JSON.stringify({ level: "info", msg: "bucket CORS set", uploadOrigins })),
    )
    .catch((error: unknown) => {
      // S3 errors and network failures often have an empty message: log what identifies them.
      const e = error as Error & {
        code?: string;
        $metadata?: { httpStatusCode?: number };
        errors?: Array<{ code?: string; message?: string }>;
      };
      console.log(
        JSON.stringify({
          level: "warn",
          msg: "could not set bucket CORS; browser uploads may fail",
          error: e?.name ?? String(error),
          message: e?.message || e?.errors?.[0]?.message || null,
          code: e?.code ?? e?.errors?.[0]?.code ?? null,
          httpStatus: e?.$metadata?.httpStatusCode ?? null,
          endpoint: process.env.S3_ENDPOINT ?? null,
        }),
      );
    });
}

// The origin people and MCP connectors use. It issues OAuth tokens, so it must be stable.
const publicUrl =
  process.env.APP_URL?.trim() || (publicDomain ? `https://${publicDomain}` : undefined);
if (!publicUrl) {
  console.log(
    JSON.stringify({ level: "warn", msg: "APP_URL not set: OAuth for MCP connectors is off" }),
  );
}

// Web Push keys are generated on first use and kept in the database.
const push = new WebPushSender(db, vapidSubject(publicUrl));

// Forms: Claude makes template PDFs fillable and fills each case's copy for a person to check.
const forms = formAiFromEnv();
const formJobs = storage ? new FormPreparer({ db, storage, ai: forms }) : null;

// The shared inbox and its agents. Both need Chatwoot; answering needs a public URL too.
const chat = chatFromEnv();
const agents =
  chat && publicUrl
    ? new ChatAgents({
        db,
        chat,
        model: chatModelsFromEnv(),
        toolbox: mcpToolbox(),
        storage,
        push,
        appUrl: publicUrl,
        forms,
        formJobs,
      })
    : null;
console.log(
  JSON.stringify({
    level: "info",
    msg: "shared inbox",
    chatwoot: chat?.publicUrl ?? null,
    agents: Boolean(agents),
    model: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  }),
);
console.log(JSON.stringify({ level: "info", msg: "forms", claude: forms?.name ?? null }));

const app = createApp({
  db,
  version,
  storage,
  push,
  uploadOrigins,
  publicUrl,
  chat,
  agents,
  forms,
  formJobs,
  webDir: production ? webDir : undefined,
});

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", msg: "server listening", port, version }));
  // Template PDFs attached before forms were filled, or whose setup failed, are set up now.
  if (forms) formJobs?.setUpPending();
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }));
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
  // Railway waits a few seconds before killing the old deployment.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
