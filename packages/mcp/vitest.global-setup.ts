import { testDatabaseUrl } from "@ezvisa/core/testing";
import { migrateDatabase } from "@ezvisa/db/testing";

/** Applies migrations to TEST_DATABASE_URL once before the run. No-op when unset. */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (url) migrateDatabase(url);
}
