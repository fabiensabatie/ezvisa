import { fileURLToPath } from "node:url";
import { LocalDiskStorage, loadRootEnv, type Storage, storageFromEnv } from "@ezvisa/core";
import { createDb } from "@ezvisa/db";
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

const app = createApp({ db, version, storage, webDir: production ? webDir : undefined });

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", msg: "server listening", port, version }));
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
