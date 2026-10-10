import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The monorepo keeps one .env at the root. On Railway the file does not exist and
// variables come from the environment instead.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `prisma generate` does not need a database, so a missing URL must not fail the config.
    url: process.env.DATABASE_URL ?? "",
  },
});
