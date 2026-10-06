import type { AddressInfo } from "node:net";
import { clients } from "@ezvisa/core";
import {
  createTestActor,
  createTestContext,
  publishSampleTemplate,
  resetDatabase,
  TEST_NOW,
  testDatabaseUrl,
} from "@ezvisa/core/testing";
import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const url = testDatabaseUrl();

describe.skipIf(!url)("dashboard sign-in and API", () => {
  let db: Db;
  let base: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    db = createDb(url as string);
    const app = createApp({
      db,
      version: "test",
      now: () => TEST_NOW,
      loginRateLimit: 5,
      secureCookies: true,
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => {
    await close();
    await db.$disconnect();
  });
  beforeEach(() => resetDatabase(db));

  const login = (token: string) =>
    fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": token.slice(-8) },
      body: JSON.stringify({ token }),
    });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const trpc = (path: string, cookie?: string, input?: unknown) =>
    fetch(
      `${base}/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
      {
        headers: cookie ? { Cookie: cookie } : {},
      },
    );

  it("exchanges a valid token for an httpOnly session cookie", async () => {
    const { token } = await createTestActor(db, "Validator", { name: "Ploy S." });
    const res = await login(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Ploy S.", role: "Validator" });
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/^ezv_session=[\w-]{43};/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(header).not.toContain(token);

    const me = await fetch(`${base}/auth/me`, { headers: { Cookie: cookieOf(res) } });
    expect(await me.json()).toMatchObject({ name: "Ploy S.", role: "Validator" });
  });

  it("refuses a bad token without setting a cookie", async () => {
    const res = await login("ezv_live_notarealtokennotarealtoken12");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("serves the API only with a live session, and ends it on logout or revocation", async () => {
    const owner = await createTestActor(db, "Owner", { name: "Namtarn" });
    expect((await trpc("me")).status).toBe(401);
    expect((await trpc("me", "ezv_session=%E0%A4%A")).status).toBe(401);

    const cookie = cookieOf(await login(owner.token));
    const me = await trpc("me", cookie);
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      result: { data: { name: string; settings: { accent: string } } };
    };
    expect(body.result.data).toMatchObject({ name: "Namtarn", settings: { accent: "#EC5F9E" } });

    await fetch(`${base}/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    expect((await trpc("me", cookie)).status).toBe(401);

    const second = cookieOf(await login(owner.token));
    expect((await trpc("me", second)).status).toBe(200);
    await db.apiToken.update({
      where: { id: owner.actor.tokenId },
      data: { revokedAt: new Date() },
    });
    expect((await trpc("me", second)).status).toBe(401);
  });

  it("returns live data for the overview and maps domain errors", async () => {
    const owner = await createTestActor(db, "Owner");
    const ctx = createTestContext(db, owner.actor);
    await publishSampleTemplate(ctx);
    await clients.createClient(ctx, {
      fullName: "Chen Wei",
      nationality: "CN",
      stayUntil: "2026-10-27",
    });
    const cookie = cookieOf(await login(owner.token));

    const overview = await trpc("overview", cookie);
    const data = ((await overview.json()) as { result: { data: Record<string, unknown> } }).result
      .data;
    expect(data).toMatchObject({ today: "2026-10-01", stats: { openCases: 0 } });
    expect((data.deadlines as unknown[]).length).toBe(1);
    expect((data.activity as Array<{ text: string }>).map((a) => a.text)).toContain(
      "added Chen Wei",
    );

    const missing = await trpc("cases.get", cookie, { case: "EZ-9999" });
    expect(missing.status).toBe(404);

    const runner = await createTestActor(db, "Runner");
    const runnerCookie = cookieOf(await login(runner.token));
    expect((await trpc("team.tokens", runnerCookie)).status).toBe(403);
  });

  it("rate-limits sign-in attempts per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" },
        body: JSON.stringify({ token: "nope" }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
