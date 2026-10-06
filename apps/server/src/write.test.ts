import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStorage } from "@ezvisa/core";
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
const DASHBOARD = "http://localhost:5173";

describe.skipIf(!url)("dashboard write side", () => {
  let db: Db;
  let base: string;
  let close: () => Promise<void>;
  let root: string;

  beforeAll(async () => {
    db = createDb(url as string);
    root = mkdtempSync(join(tmpdir(), "ezvisa-uploads-"));
    const server = createApp({
      db,
      version: "test",
      now: () => TEST_NOW,
      storage: new LocalDiskStorage(root, "http://placeholder"),
      uploadOrigins: [DASHBOARD],
    }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => {
    await close();
    await db.$disconnect();
    rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => resetDatabase(db));

  async function signIn(role: string) {
    const { token, actor } = await createTestActor(db, role, { name: `${role} person` });
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": actor.employeeId },
      body: JSON.stringify({ token }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    return { cookie, actor };
  }

  /** Calls a tRPC mutation the way the dashboard's non-batched link does. */
  async function mutate(cookie: string, path: string, input: unknown) {
    const res = await fetch(`${base}/trpc/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(input),
    });
    const body = (await res.json()) as {
      result?: { data: Record<string, unknown> };
      error?: { message: string };
    };
    return { status: res.status, data: body.result?.data, error: body.error?.message };
  }

  it("runs a case from a new client to an approved pack, enforcing every guard", async () => {
    const { cookie, actor } = await signIn("Owner");
    await publishSampleTemplate(createTestContext(db, actor));

    const client = await mutate(cookie, "clients.create", {
      fullName: "Margaret Ellis",
      nationality: "gb",
      consentGiven: true,
    });
    expect(client.status).toBe(200);
    const opened = await mutate(cookie, "cases.create", {
      clientId: client.data?.id,
      template: "retirement-extension",
      assigneeId: actor.employeeId,
      dueDate: "2026-10-20",
    });
    const number = opened.data?.number as string;
    const items = opened.data?.items as Array<{ id: string; required: boolean }>;
    expect(number).toBe("EZ-1000");

    const early = await mutate(cookie, "cases.moveStage", { case: number, stage: "VALIDATION" });
    expect(early.status).toBe(412);
    expect(early.error).toContain("still need attention");

    const flagged = await mutate(cookie, "cases.updateItem", {
      case: number,
      itemId: items[0]?.id,
      status: "FLAGGED",
    });
    expect(flagged.status).toBe(400);
    expect(flagged.error).toBe("A FLAGGED item needs a note saying why.");

    for (const item of items.filter((i) => i.required)) {
      const res = await mutate(cookie, "cases.updateItem", {
        case: number,
        itemId: item.id,
        status: "VERIFIED",
      });
      expect(res.status).toBe(200);
    }
    for (const stage of ["COLLECTING", "DRAFTING", "VALIDATION", "SUBMISSION"]) {
      expect((await mutate(cookie, "cases.moveStage", { case: number, stage })).status).toBe(200);
    }
    const done = await mutate(cookie, "cases.close", { case: number, outcome: "APPROVED" });
    expect(done.data).toMatchObject({ stage: "DONE", outcome: "APPROVED" });

    const runner = await signIn("Runner");
    const forbidden = await mutate(runner.cookie, "clients.create", {
      fullName: "Nobody",
      nationality: "TH",
    });
    expect(forbidden.status).toBe(403);
  });

  it("uploads a document from the dashboard origin straight to storage, then confirms it", async () => {
    const { cookie } = await signIn("Validator");
    const client = await mutate(cookie, "clients.create", {
      fullName: "Chen Wei",
      nationality: "CN",
      consentGiven: true,
    });
    const upload = await mutate(cookie, "documents.createUpload", {
      clientId: client.data?.id,
      filename: "passport.png",
      mimeType: "image/png",
      sizeBytes: 4,
    });
    expect(upload.status).toBe(200);
    // LocalDiskStorage signs links for its own base URL; point them at the test server.
    const link = new URL(String(upload.data?.uploadUrl));
    const target = `${base}${link.pathname}${link.search}`;

    const preflight = await fetch(target, {
      method: "OPTIONS",
      headers: {
        Origin: DASHBOARD,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(DASHBOARD);
    const elsewhere = await fetch(target, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "PUT" },
    });
    expect(elsewhere.headers.get("access-control-allow-origin")).toBeNull();

    const put = await fetch(target, {
      method: "PUT",
      headers: { Origin: DASHBOARD, "Content-Type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    });
    expect(put.status).toBe(200);

    const confirmed = await mutate(cookie, "documents.confirmUpload", {
      uploadKey: upload.data?.uploadKey,
      clientId: client.data?.id,
      filename: "passport.png",
      mimeType: "image/png",
    });
    expect(confirmed.data).toMatchObject({ filename: "passport.png", sizeBytes: 4 });
  });

  it("creates a token once for the owner and saves the agency colour", async () => {
    const { cookie, actor } = await signIn("Owner");
    const created = await mutate(cookie, "team.createToken", {
      employeeId: actor.employeeId,
      label: "Spare laptop",
    });
    expect(String(created.data?.secret)).toMatch(/^ezv_live_/);
    const listed = await fetch(`${base}/trpc/team.tokens`, { headers: { Cookie: cookie } });
    expect(JSON.stringify(await listed.json())).not.toContain(String(created.data?.secret));

    const saved = await mutate(cookie, "settings.update", { accent: "#2db38a" });
    expect(saved.data).toMatchObject({ accent: "#2DB38A" });
  });
});
