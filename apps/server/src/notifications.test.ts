import type { AddressInfo } from "node:net";
import type { PushMessage, PushSender, PushTarget } from "@ezvisa/core";
import { createTestActor, resetDatabase, TEST_NOW, testDatabaseUrl } from "@ezvisa/core/testing";
import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const url = testDatabaseUrl();

class FakeSender implements PushSender {
  readonly sent: Array<{ endpoint: string; message: PushMessage }> = [];
  async publicKey() {
    return "BPublicKeyForTests";
  }
  async send(target: PushTarget, message: PushMessage) {
    this.sent.push({ endpoint: target.endpoint, message });
    return "sent" as const;
  }
}

describe.skipIf(!url)("notifications over the dashboard API", () => {
  let db: Db;
  let base: string;
  let close: () => Promise<void>;
  const push = new FakeSender();

  beforeAll(async () => {
    db = createDb(url as string);
    const server = createApp({ db, version: "test", now: () => TEST_NOW, push }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(async () => {
    await close();
    await db.$disconnect();
  });
  beforeEach(() => resetDatabase(db));

  it("subscribes this browser, reports it, and sends a test to it", async () => {
    const { token, actor } = await createTestActor(db, "Owner");
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": actor.employeeId },
      body: JSON.stringify({ token }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const call = async (path: string, input?: unknown, method = "POST") => {
      const query =
        input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
      const res = await fetch(`${base}/trpc/${path}${method === "GET" ? query : ""}`, {
        method,
        headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(method === "POST" && input !== undefined ? { body: JSON.stringify(input) } : {}),
      });
      return ((await res.json()) as { result?: { data: unknown } }).result?.data;
    };
    const endpoint = "https://push.example.com/abc";

    expect(await call("notifications.config", undefined, "GET")).toEqual({
      publicKey: "BPublicKeyForTests",
    });
    expect(await call("notifications.status", { endpoint }, "GET")).toEqual({ subscribed: false });
    await call("notifications.subscribe", { endpoint, keys: { p256dh: "p", auth: "a" } });
    expect(await call("notifications.status", { endpoint }, "GET")).toEqual({ subscribed: true });
    expect(await call("notifications.test")).toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(push.sent[0]?.endpoint).toBe(endpoint);
  });
});
