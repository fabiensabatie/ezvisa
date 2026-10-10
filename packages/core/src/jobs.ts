import type { Db } from "@ezvisa/db";
import { bangkokToday } from "./dates.js";
import { syncReminders } from "./services/reminders.js";

/**
 * The daily run, at 08:00 Asia/Bangkok: schedules reminders for new or changed client
 * deadlines, cancels stale ones and marks today's as due. Safe to run more than once a day.
 */
export async function runDailyJob(db: Db, now = new Date()) {
  const today = bangkokToday(now);
  await db.$transaction((tx) => syncReminders(tx, today), { timeout: 120_000 });
  const remindersDue = await db.reminder.count({ where: { status: "DUE" } });
  return { today, remindersDue };
}
