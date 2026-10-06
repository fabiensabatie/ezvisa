import {
  authenticateSession,
  createSession,
  endSession,
  SESSION_COOKIE,
  SESSION_DAYS,
} from "@ezvisa/core";
import type { Db } from "@ezvisa/db";
import express, { type Router } from "express";
import { readCookie, sessionCookie } from "./cookies.js";
import { createRateLimiter } from "./rate-limit.js";

export type AuthRouteOptions = {
  db: Db;
  now?: () => Date;
  /** Secure cookies need HTTPS: on in production, off on localhost. */
  secureCookies: boolean;
  loginRateLimit?: number;
};

/** POST /auth/login, POST /auth/logout, GET /auth/me. */
export function authRouter(options: AuthRouteOptions): Router {
  const now = options.now ?? (() => new Date());
  const allow = createRateLimiter(options.loginRateLimit ?? 10, 60_000);
  const router = express.Router();
  const json = express.json({ limit: "4kb" });

  router.post("/auth/login", json, async (req, res) => {
    if (!allow(`ip:${req.ip}`)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "Too many sign-in attempts. Wait a minute and try again." });
      return;
    }
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    try {
      const session = await createSession(options.db, token, now());
      res.setHeader(
        "Set-Cookie",
        sessionCookie(SESSION_COOKIE, session.id, {
          maxAgeSeconds: SESSION_DAYS * 86_400,
          secure: options.secureCookies,
        }),
      );
      res.json({ name: session.actor.name, role: session.actor.roleName });
    } catch {
      res.status(401).json({ error: "That token is not valid. Check it and try again." });
    }
  });

  router.post("/auth/logout", async (req, res) => {
    const id = readCookie(req.header("cookie"), SESSION_COOKIE);
    if (id) await endSession(options.db, id);
    res.setHeader(
      "Set-Cookie",
      sessionCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: options.secureCookies }),
    );
    res.json({ ok: true });
  });

  router.get("/auth/me", async (req, res) => {
    try {
      const id = readCookie(req.header("cookie"), SESSION_COOKIE) ?? "";
      const actor = await authenticateSession(options.db, id, now());
      res.json({ name: actor.name, role: actor.roleName, kind: actor.kind });
    } catch {
      res.status(401).json({ error: "Not signed in." });
    }
  });

  return router;
}
