import { migrateDatabase } from "@ezvisa/db/testing";
import { testDatabaseUrl } from "./src/testing.js";

/** Applies migrations to TEST_DATABASE_URL once before the run. No-op when unset. */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (url) migrateDatabase(url);
}
