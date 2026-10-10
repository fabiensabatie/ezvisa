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
import { createClient, updateClient } from "./clients.js";
import {
  listDeadlines,
  listReminders,
  markReminderSent,
  renderReminder,
  skipReminder,
} from "./reminders.js";

const url = testDatabaseUrl();

describe("renderReminder", () => {
  it("fills every variable", () => {
    expect(
      renderReminder("Hi {first_name}, {deadline} in {days_left} days. {agent_name}", {
        firstName: "Chen",
        deadline: "2026-10-27",
        daysLeft: 26,
        agentName: "Namtarn",
      }),
    ).toBe("Hi Chen, 27 Oct in 26 days. Namtarn");
  });
});

describe.skipIf(!url)("reminders service", () => {
  let db: Db;
  let owner: Context;

  beforeAll(() => {
    db = createDb(url as string);
  });
  afterAll(() => db.$disconnect());
  beforeEach(async () => {
    await resetDatabase(db);
    owner = createTestContext(db, (await createTestActor(db, "Owner")).actor);
  });

  it("schedules future offsets plus one catch-up, and marks today's reminders DUE", async () => {
    // Stay ends in 26 days: 60 and 30 have passed, 14 and 7 are ahead.
    const chen = await createClient(owner, {
      fullName: "Chen Wei",
      nationality: "CN",
      stayUntil: "2026-10-27",
      channel: "WHATSAPP",
    });
    const { items } = await listReminders(owner, { withinDays: 60 });
    const forChen = items.filter((r) => r.client.id === chen.id);
    expect(forChen.map((r) => [r.offsetDays, r.sendOn, r.status])).toEqual([
      [30, "2026-10-01", "DUE"],
      [14, "2026-10-13", "SCHEDULED"],
      [7, "2026-10-20", "SCHEDULED"],
    ]);
    expect(forChen[0]?.message).toBe(
      "Hi Chen, your permission to stay in Thailand ends on 27 Oct, in 26 days. Reply here and we will start your extension. Namtarn, EzVisa",
    );
    expect(forChen[0]?.channel).toBe("WHATSAPP");

    // Running again creates nothing new.
    await listReminders(owner, { withinDays: 60 });
    expect(await db.reminder.count({ where: { clientId: chen.id } })).toBe(3);
  });

  it("cancels pending reminders when the deadline moves", async () => {
    const client = await createClient(owner, {
      fullName: "Tom",
      nationality: "AU",
      stayUntil: "2026-10-06",
    });
    await listReminders(owner, {});
    await updateClient(owner, { clientId: client.id, stayUntil: "2027-10-06" });
    await listReminders(owner, {});
    const statuses = await db.reminder.findMany({
      where: { clientId: client.id },
      select: { status: true },
    });
    expect(statuses.every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("marks reminders sent or skipped once", async () => {
    await createClient(owner, {
      fullName: "David Cohen",
      nationality: "US",
      nextReportDue: "2026-10-03",
    });
    const { items } = await listReminders(owner, {});
    const [first, second] = items;
    const sent = await markReminderSent(owner, { reminderId: first?.id ?? "" });
    expect(sent.status).toBe("SENT");
    expect(sent.message).toContain("90-day report is due on 3 Oct");
    await expect(markReminderSent(owner, { reminderId: first?.id ?? "" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    // The dashboard keeps today's sent reminders on screen; the default list drops them.
    const ids = async (input: { includeSentToday?: boolean }) =>
      (await listReminders(owner, { withinDays: 30, ...input })).items.map((r) => r.id);
    expect(await ids({ includeSentToday: true })).toContain(sent.id);
    expect(await ids({})).not.toContain(sent.id);
    if (second) {
      expect((await skipReminder(owner, { reminderId: second.id, note: "Replied" })).status).toBe(
        "SKIPPED",
      );
    }
  });

  it("lists deadlines with days left", async () => {
    await createClient(owner, { fullName: "Priya", nationality: "IN", stayUntil: "2026-10-20" });
    await createClient(owner, { fullName: "Far", nationality: "IN", stayUntil: "2027-06-01" });
    const { today, items } = await listDeadlines(owner, { withinDays: 30 });
    expect(today).toBe("2026-10-01");
    expect(items).toEqual([
      expect.objectContaining({
        kind: "STAY_ENDS",
        deadline: "2026-10-20",
        daysLeft: 19,
        openCase: null,
      }),
    ]);
  });

  it("runs the daily job idempotently", async () => {
    // Stay ends in 7 days: the 7-day reminder is due today, so no catch-up is added.
    const tom = await createClient(owner, {
      fullName: "Tom Richards",
      nationality: "AU",
      stayUntil: "2026-10-08",
    });
    const result = await runDailyJob(db, TEST_NOW);
    expect(result).toEqual({ today: "2026-10-01", remindersDue: 1 });
    expect(await runDailyJob(db, TEST_NOW)).toEqual(result);
    const rows = await db.reminder.findMany({ where: { clientId: tom.id } });
    expect(rows.map((r) => [r.offsetDays, r.status])).toEqual([[7, "DUE"]]);
  });
});
