import type { Db } from "@ezvisa/db";
import { bangkokToday } from "./dates.js";
import { notifyRemindersDue, type PushSender } from "./services/notifications.js";
import { syncReminders } from "./services/reminders.js";

/**
 * The daily run, at 08:00 Asia/Bangkok: schedules reminders for new or changed client
 * deadlines, cancels stale ones and marks today's as due, then notifies the people who send
 * them. It also clears expired OAuth codes and access tokens. Safe to run more than once a
 * day, although each run notifies again.
 */
export async function runDailyJob(db: Db, now = new Date(), push: PushSender | null = null) {
  const today = bangkokToday(now);
  await db.$transaction((tx) => syncReminders(tx, today), { timeout: 120_000 });
  await db.oAuthCode.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.oAuthAccessToken.deleteMany({ where: { expiresAt: { lte: now } } });
  const remindersDue = await db.reminder.count({ where: { status: "DUE" } });
  const notifications = push ? await notifyRemindersDue(db, push, now) : null;
  return { today, remindersDue, notifications };
}
