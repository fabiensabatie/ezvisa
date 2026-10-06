import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Storage } from "@ezvisa/core";
import type { Db } from "@ezvisa/db";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express } from "express";
import { mcpRouter } from "./mcp.js";
import { appRouter } from "./router.js";

export type AppOptions = {
  db: Db;
  version: string;
  /** Document storage. Null when no bucket is configured. */
  storage?: Storage | null;
  /** Built dashboard to serve. Omitted in development, where Vite serves it. */
  webDir?: string;
  now?: () => Date;
  mcpRateLimit?: number;
};

const API_PREFIXES = ["/trpc", "/auth", "/mcp", "/health"];

export function createApp({
  db,
  version,
  webDir,
  storage = null,
  now,
  mcpRateLimit,
}: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get("/health", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: "ok", database: "ok", version });
    } catch {
      res.status(503).json({ status: "error", database: "unreachable", version });
    }
  });

  app.use(mcpRouter({ db, storage, version, now, rateLimit: mcpRateLimit }));

  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: () => ({ requestId: randomUUID() }),
    }),
  );

  if (webDir && existsSync(join(webDir, "index.html"))) {
    app.use(
      express.static(webDir, {
        index: false,
        setHeaders(res, path) {
          // Vite fingerprints everything under /assets, so it can be cached forever.
          if (/[\\/]assets[\\/]/.test(path)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    // Single-page app: unknown non-API paths return index.html.
    app.get("/{*path}", (req, res, next) => {
      if (API_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
      res.setHeader("Cache-Control", "no-cache");
      // `root` keeps the dot-file check on the relative path only, so a checkout under a
      // dot-folder (such as .claude/worktrees) still serves the page.
      res.sendFile("index.html", { root: webDir });
    });
  }

  return app;
}
