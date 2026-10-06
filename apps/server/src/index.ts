import { fileURLToPath } from "node:url";
import { loadRootEnv } from "@ezvisa/core";
import { createDb } from "@ezvisa/db";
import { createApp } from "./app.js";

loadRootEnv();

const db = createDb();
const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
const production = process.env.NODE_ENV === "production";
// src/index.ts and dist/index.js both resolve to apps/web/dist.
const webDir = fileURLToPath(new URL("../../web/dist", import.meta.url));

const app = createApp({ db, version, webDir: production ? webDir : undefined });
const port = Number(process.env.PORT ?? 3000);

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
