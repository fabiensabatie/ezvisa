import { runDailyJob } from "../jobs.js";
import { runWithDb } from "./cli.js";

// Usage: pnpm job:daily. On Railway the "jobs" cron service runs the compiled version daily.

await runWithDb(async (db) => {
  const started = Date.now();
  const result = await runDailyJob(db);
  console.log(
    JSON.stringify({ level: "info", msg: "daily job done", ...result, ms: Date.now() - started }),
  );
});
