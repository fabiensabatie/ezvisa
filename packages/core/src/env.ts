import { fileURLToPath } from "node:url";
import { config } from "dotenv";

/**
 * Loads the monorepo's root .env when it exists. On Railway there is no file and
 * the variables come from the environment, so this is a no-op there.
 */
export function loadRootEnv(): void {
  // src/env.ts and dist/env.js both sit three levels below the repository root.
  const path = fileURLToPath(new URL("../../../.env", import.meta.url));
  config({ path, quiet: true });
}
