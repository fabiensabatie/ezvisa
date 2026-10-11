import type { Db } from "@ezvisa/db";
import webpush from "web-push";
import { z } from "zod";
import { audit } from "../audit.js";
import type { Context } from "../context.js";
import { DomainError } from "../errors.js";
import { hasLevel, parsePermissions } from "../permissions.js";

/** What a device shows. Phones show about two lines, so keep it short. */
export type PushMessage = { title: string; body: string; url: string; tag: string };
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/** "gone" means the browser unsubscribed or expired: the subscription can be deleted. */
export type PushResult = "sent" | "gone" | "failed";

/** Delivers Web Push messages. The server and the daily job use WebPushSender; tests a fake. */
export interface PushSender {
  publicKey(): Promise<string>;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

const VAPID_SETTING = "push.vapid";
type VapidKeys = { publicKey: string; privateKey: string };

/**
 * The VAPID key pair that signs every push message. Generated on first use and kept in
 * Settings, so every deploy and the daily job sign with the same keys and existing
 * subscriptions stay valid. One row holds both keys, so a race cannot mix two pairs.
 */
export async function vapidKeys(db: Db): Promise<VapidKeys> {
  const read = async () => {
    const row = await db.setting.findUnique({ where: { key: VAPID_SETTING } });
    const value = row?.value as Partial<VapidKeys> | undefined;
    return value?.publicKey && value.privateKey
      ? { publicKey: value.publicKey, privateKey: value.privateKey }
      : null;
  };
  const existing = await read();
  if (existing) return existing;
  const generated = webpush.generateVAPIDKeys();
  await db.setting.createMany({
    data: [
      {
        key: VAPID_SETTING,
        value: { publicKey: generated.publicKey, privateKey: generated.privateKey },
      },
    ],
    skipDuplicates: true,
  });
  const stored = await read();
  if (!stored) throw new Error("The push keys could not be stored.");
  return stored;
}

/** The contact push services see in each message: the dashboard URL, or a mailto. */
export function vapidSubject(appUrl: string | undefined): string {
  return appUrl?.startsWith("https://") ? appUrl : "mailto:notifications@ezvisa.invalid";
}

export class WebPushSender implements PushSender {
  private keys: Promise<VapidKeys> | null = null;

  constructor(
    private readonly db: Db,
    private readonly subject: string,
  ) {}

  private load(): Promise<VapidKeys> {
    this.keys ??= vapidKeys(this.db);
    return this.keys;
  }

  async publicKey(): Promise<string> {
    return (await this.load()).publicKey;
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    const keys = await this.load();
    try {
      // web-push signs (VAPID) and encrypts (aes128gcm); fetch delivers to the push service.
      const request = webpush.generateRequestDetails(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: { subject: this.subject, ...keys },
          // Undelivered after 12 hours (phone off all day), the message is dropped.
          TTL: 12 * 3600,
        },
      );
      const res = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers as Record<string, string>,
        body: request.body ? new Uint8Array(request.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return "sent";
      return res.status === 404 || res.status === 410 ? "gone" : "failed";
    } catch {
      return "failed";
    }
  }
}

// ---- subscriptions ----------------------------------------------------------------

export const subscribeInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  userAgent: z.string().max(300).optional(),
});
export const endpointInput = z.object({ endpoint: z.string().url().max(2000) });

function requirePush(ctx: Context): PushSender {
  if (!ctx.push) throw new DomainError("CONFLICT", "Notifications are not set up on this server.");
  return ctx.push;
}

/** The public key a browser needs to subscribe. */
export async function pushConfig(ctx: Context) {
  return { publicKey: await requirePush(ctx).publicKey() };
}

/** Whether this browser's subscription is registered for the signed-in person. */
export async function subscriptionStatus(ctx: Context, raw: z.input<typeof endpointInput>) {
  const { endpoint } = endpointInput.parse(raw);
  const row = await ctx.db.pushSubscription.findUnique({ where: { endpoint } });
  return { subscribed: row?.employeeId === ctx.actor.employeeId };
}

/** Registers this browser. A browser belongs to whoever subscribed it last. */
export async function subscribe(ctx: Context, raw: z.input<typeof subscribeInput>) {
  const input = subscribeInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const data = {
      employeeId: ctx.actor.employeeId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
    };
    const row = await tx.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
    await audit(tx, ctx, {
      action: "push.subscribed",
      entity: "PushSubscription",
      entityId: row.id,
      after: { userAgent: row.userAgent },
    });
    return { subscribed: true as const };
  });
}

export async function unsubscribe(ctx: Context, raw: z.input<typeof endpointInput>) {
  const { endpoint } = endpointInput.parse(raw);
  return ctx.db.$transaction(async (tx) => {
    const row = await tx.pushSubscription.findUnique({ where: { endpoint } });
    if (row && row.employeeId === ctx.actor.employeeId) {
      await tx.pushSubscription.delete({ where: { id: row.id } });
      await audit(tx, ctx, {
        action: "push.unsubscribed",
        entity: "PushSubscription",
        entityId: row.id,
      });
    }
    return { subscribed: false as const };
  });
}

// ---- sending ------------------------------------------------------------------------

type Delivery = { sent: number; gone: number; failed: number };

async function deliver(
  db: Db,
  sender: PushSender,
  subscriptions: Array<{ id: string } & PushTarget>,
  message: PushMessage,
  now: Date,
): Promise<Delivery> {
  const result: Delivery = { sent: 0, gone: 0, failed: 0 };
  for (const sub of subscriptions) {
    const outcome = await sender.send(sub, message);
    result[outcome]++;
    if (outcome === "gone") {
      await db.pushSubscription.deleteMany({ where: { id: sub.id } });
    } else if (outcome === "sent") {
      await db.pushSubscription.update({ where: { id: sub.id }, data: { lastSentAt: now } });
    }
  }
  return result;
}

/** Sends a test notification to the signed-in person's devices. */
export async function sendTest(ctx: Context) {
  const sender = requirePush(ctx);
  const subscriptions = await ctx.db.pushSubscription.findMany({
    where: { employeeId: ctx.actor.employeeId },
  });
  if (subscriptions.length === 0) {
    throw new DomainError("CONFLICT", "Turn notifications on in this browser first.");
  }
  return deliver(
    ctx.db,
    sender,
    subscriptions,
    {
      title: "EzVisa notifications are on",
      body: "You will hear from EzVisa at 08:00 when reminders are due.",
      url: "/settings",
      tag: "test",
    },
    ctx.now(),
  );
}

/**
 * Tells everyone who can send reminders how many are waiting. Run by the daily job after
 * it syncs reminders. Client names stay out of the message, which can show on a locked phone.
 */
export async function notifyRemindersDue(db: Db, sender: PushSender, now = new Date()) {
  const due = await db.reminder.count({ where: { status: "DUE" } });
  if (due === 0) return { due, sent: 0, gone: 0, failed: 0 };

  const subscriptions = await db.pushSubscription.findMany({
    where: { employee: { active: true, kind: "HUMAN" } },
    include: { employee: { include: { role: true } } },
  });
  const recipients = subscriptions.filter((s) =>
    hasLevel(parsePermissions(s.employee.role.permissions), "reminders", "edit"),
  );
  const delivery = await deliver(
    db,
    sender,
    recipients,
    {
      title: due === 1 ? "1 reminder to send today" : `${due} reminders to send today`,
      body: "Open EzVisa to copy each message and send it to the client.",
      url: "/reminders",
      // One notification per device: today's replaces yesterday's if it was not opened.
      tag: "reminders-due",
    },
    now,
  );
  return { due, ...delivery };
}
