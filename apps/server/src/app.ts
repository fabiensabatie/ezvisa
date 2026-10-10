import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  authenticateSession,
  LOCAL_STORAGE_PATH,
  LocalDiskStorage,
  SESSION_COOKIE,
  type Storage,
} from "@ezvisa/core";
import type { Db } from "@ezvisa/db";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express, { type Express } from "express";
import { authRouter } from "./auth.js";
import { readCookie } from "./cookies.js";
import { devStorageRouter } from "./dev-storage.js";
import { mcpRouter } from "./mcp.js";
import { oauthRouter, resourceMetadataUrl } from "./oauth.js";
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
  loginRateLimit?: number;
  /** Defaults to true in production. Secure cookies need HTTPS. */
  secureCookies?: boolean;
  /** Dashboard origins allowed to PUT to local storage links (development only). */
  uploadOrigins?: string[];
  /**
   * The public origin people and connectors reach, e.g. https://app.example.com. Enables
   * OAuth for MCP connectors; without it, /mcp accepts personal tokens only.
   */
  publicUrl?: string;
};

const API_PREFIXES = ["/trpc", "/auth", "/mcp", "/health", "/.well-known", LOCAL_STORAGE_PATH];
/** OAuth endpoints served by the MCP SDK at the root. */
const API_PATHS = new Set(["/authorize", "/token", "/register", "/revoke"]);

export function createApp({
  db,
  version,
  webDir,
  storage = null,
  now = () => new Date(),
  mcpRateLimit,
  loginRateLimit,
  secureCookies = process.env.NODE_ENV === "production",
  uploadOrigins = [],
  publicUrl,
}: AppOptions): Express {
  const origin = publicUrl?.replace(/\/+$/, "");
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

  app.use(authRouter({ db, now, secureCookies, loginRateLimit }));
  if (origin) app.use(oauthRouter({ db, publicUrl: origin, now }));
  app.use(
    mcpRouter({
      db,
      storage,
      version,
      now,
      rateLimit: mcpRateLimit,
      resourceMetadataUrl: origin ? resourceMetadataUrl(origin) : undefined,
    }),
  );
  if (storage instanceof LocalDiskStorage) app.use(devStorageRouter(storage, uploadOrigins));

  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      async createContext({ req }) {
        const sessionId = readCookie(req.header("cookie"), SESSION_COOKIE);
        const actor = sessionId
          ? await authenticateSession(db, sessionId, now()).catch(() => null)
          : null;
        return { requestId: randomUUID(), db, storage, now, actor };
      },
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
      if (API_PATHS.has(req.path) || API_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
        return next();
      }
      res.setHeader("Cache-Control", "no-cache");
      // `root` keeps the dot-file check on the relative path only, so a checkout under a
      // dot-folder (such as .claude/worktrees) still serves the page.
      res.sendFile("index.html", { root: webDir });
    });
  }

  return app;
}
