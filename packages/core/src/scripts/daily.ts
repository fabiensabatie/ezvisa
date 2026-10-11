import { runDailyJob } from "../jobs.js";
import { vapidSubject, WebPushSender } from "../services/notifications.js";
import { runWithDb } from "./cli.js";

// Usage: pnpm job:daily. On Railway the "jobs" cron service runs the compiled version daily.

await runWithDb(async (db) => {
  const started = Date.now();
  const push = new WebPushSender(db, vapidSubject(process.env.APP_URL));
  const result = await runDailyJob(db, new Date(), push);
  console.log(
    JSON.stringify({ level: "info", msg: "daily job done", ...result, ms: Date.now() - started }),
  );
});
