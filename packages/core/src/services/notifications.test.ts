import { createECDH, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb, type Db } from "@ezvisa/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context.js";
import { runDailyJob } from "../jobs.js";
import {
  createTestActor,
  createTestContext,
  resetDatabase,
  TEST_NOW,
  testDatabaseUrl,
} from "../testing.js";
import { createClient } from "./clients.js";
import {
  notifyRemindersDue,
  type PushMessage,
  type PushResult,
  type PushSender,
  type PushTarget,
  sendTest,
  subscribe,
  subscriptionStatus,
  unsubscribe,
  vapidKeys,
  vapidSubject,
  WebPushSender,
} from "./notifications.js";

const url = testDatabaseUrl();

class FakeSender implements PushSender {
  readonly sent: Array<{ endpoint: string; message: PushMessage }> = [];
  readonly gone = new Set<string>();
  async publicKey() {
    return "test-public-key";
  }
  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    if (this.gone.has(target.endpoint)) return "gone";
    this.sent.push({ endpoint: target.endpoint, message });
    return "sent";
  }
}

const device = (name: string) => ({
  endpoint: `https://push.example.com/${name}`,
  keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
});

describe.skipIf(!url)("notifications", () => {
  let db: Db;
  let push: FakeSender;
  let owner: Context;

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    push = new FakeSender();
    const actor = (await createTestActor(db, "Owner", { name: "Namtarn" })).actor;
    owner = { ...createTestContext(db, actor, { via: "DASHBOARD" }), push };
  });

  async function person(role: string, name: string): Promise<Context> {
    const { actor } = await createTestActor(db, role, { name });
    return { ...createTestContext(db, actor, { via: "DASHBOARD" }), push };
  }

  it("generates the signing keys once and keeps them", async () => {
    const first = await vapidKeys(db);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(await vapidKeys(db)).toEqual(first);
  });

  it("registers a browser for whoever subscribed it last", async () => {
    const ploy = await person("Validator", "Ploy S.");
    await subscribe(owner, device("laptop"));
    expect(await subscriptionStatus(owner, device("laptop"))).toEqual({ subscribed: true });

    // Ploy signs in on the same browser and turns notifications on: it is hers now.
    await subscribe(ploy, device("laptop"));
    expect(await subscriptionStatus(owner, device("laptop"))).toEqual({ subscribed: false });
    await unsubscribe(owner, device("laptop"));
    expect(await subscriptionStatus(ploy, device("laptop"))).toEqual({ subscribed: true });

    await unsubscribe(ploy, device("laptop"));
    expect(await db.pushSubscription.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: { startsWith: "push." } } })).toBe(3);
  });

  it("notifies only active people who can send reminders, and drops expired devices", async () => {
    const ploy = await person("Validator", "Ploy S.");
    const beam = await person("Runner", "Beam T.");
    const gone = await person("Senior agent", "Former agent");
    await subscribe(owner, device("namtarn"));
    await subscribe(owner, device("namtarn-old"));
    await subscribe(ploy, device("ploy"));
    await subscribe(beam, device("beam"));
    await subscribe(gone, device("former"));
    await db.employee.update({ where: { id: gone.actor.employeeId }, data: { active: false } });
    push.gone.add(device("namtarn-old").endpoint);

    expect(await notifyRemindersDue(db, push, TEST_NOW)).toMatchObject({ due: 0, sent: 0 });
    expect(push.sent).toHaveLength(0);

    // Stay ends in 7 days: the 7-day reminder is due today.
    await createClient(owner, {
      fullName: "Tom Richards",
      nationality: "AU",
      stayUntil: "2026-10-08",
    });
    const result = await runDailyJob(db, TEST_NOW, push);
    expect(result.notifications).toEqual({ due: 1, sent: 2, gone: 1, failed: 0 });
    expect(push.sent.map((s) => s.endpoint).sort()).toEqual([
      device("namtarn").endpoint,
      device("ploy").endpoint,
    ]);
    expect(push.sent[0]?.message).toEqual({
      title: "1 reminder to send today",
      body: "Open EzVisa to copy each message and send it to the client.",
      url: "/reminders",
      tag: "reminders-due",
    });
    expect(JSON.stringify(push.sent)).not.toContain("Tom");

    const left = await db.pushSubscription.findMany({ orderBy: { endpoint: "asc" } });
    expect(left.map((s) => s.endpoint)).not.toContain(device("namtarn-old").endpoint);
    expect(left.find((s) => s.endpoint === device("ploy").endpoint)?.lastSentAt).toEqual(TEST_NOW);
  });

  it("sends a test only to the person's own devices", async () => {
    await expect(sendTest(owner)).rejects.toMatchObject({ code: "CONFLICT" });
    const ploy = await person("Validator", "Ploy S.");
    await subscribe(ploy, device("ploy"));
    await subscribe(owner, device("namtarn"));
    expect(await sendTest(owner)).toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(push.sent.map((s) => s.endpoint)).toEqual([device("namtarn").endpoint]);
    expect(push.sent[0]?.message.tag).toBe("test");
  });

  it("delivers a signed, encrypted message to a push service", async () => {
    // A stand-in push service that records the request, then answers like a real one.
    const received: Array<{ headers: IncomingHttpHeaders; bytes: number }> = [];
    let answer = 201;
    const server = createServer((req, res) => {
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      req.on("end", () => {
        received.push({ headers: req.headers, bytes });
        res.writeHead(answer).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      // Keys shaped like a browser's: an uncompressed P-256 public key and a 16-byte secret.
      const ecdh = createECDH("prime256v1");
      ecdh.generateKeys();
      const target = {
        endpoint: `http://127.0.0.1:${port}/push/device-1`,
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      };
      const sender = new WebPushSender(db, vapidSubject("https://ezvisa.example"));
      const message = { title: "Hi", body: "Test", url: "/", tag: "test" };

      expect(await sender.send(target, message)).toBe("sent");
      const [request] = received;
      expect(request?.headers["content-encoding"]).toBe("aes128gcm");
      expect(request?.headers.ttl).toBe("43200");
      expect(request?.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
      expect(request?.headers.authorization).toContain((await vapidKeys(db)).publicKey);
      expect(request?.bytes).toBeGreaterThan(100);

      answer = 410;
      expect(await sender.send(target, message)).toBe("gone");
      answer = 500;
      expect(await sender.send(target, message)).toBe("failed");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
