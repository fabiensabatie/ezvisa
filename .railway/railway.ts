import { bucket, defineRailway, github, postgres, preserve, project, service } from "railway/iac";

// EzVisa on Railway, all in Singapore. See docs/04-mvp-spec.md section 12.
//
// The Railway project ("considerate-vitality", workspace FSOFTWARE) also runs services from
// other repositories, so this file is a named partial: `railway config apply` manages only
// what is declared here and leaves every other service alone. Never remove the export below:
// without it, an apply would treat this file as the whole project and delete the rest.
export const partial = "ezvisa";

const SINGAPORE = "asia-southeast1-eqsg3a";
const REPO = github("fabiensabatie/ezvisa", { branch: "main" });

export default defineRailway(() => {
  const db = postgres("Postgres", { region: SINGAPORE });
  // Client documents and template forms. The `documents-backup` bucket (spec 12.6) is added
  // together with the nightly backup job.
  const documents = bucket("documents", { region: "sin" });

  // Dashboard, /trpc, /auth, /mcp and the OAuth endpoints for MCP connectors.
  const ezvisa = service("ezvisa", {
    source: REPO,
    build: {
      buildCommand: "pnpm turbo run build --filter=@ezvisa/server... --filter=@ezvisa/web...",
      watchPatterns: ["/apps/**", "/packages/**", "/pnpm-lock.yaml"],
    },
    preDeploy: "pnpm --filter @ezvisa/db migrate:deploy",
    start: "pnpm --filter @ezvisa/server start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { [SINGAPORE]: 1 },
    deploy: { limitOverride: { containers: { cpu: 2, memoryBytes: 2_000_000_000 } } },
    // The service answers on its Railway domain. Add the custom domain here once it is
    // chosen; APP_URL then changes with it and MCP connectors must be connected again.
    env: {
      NODE_ENV: "production",
      PORT: "3000",
      APP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      DATABASE_URL: db.env.DATABASE_URL,
      S3_ENDPOINT: "${{documents.ENDPOINT}}",
      S3_REGION: "${{documents.REGION}}",
      S3_BUCKET: "${{documents.BUCKET}}",
      S3_ACCESS_KEY_ID: "${{documents.ACCESS_KEY_ID}}",
      S3_SECRET_ACCESS_KEY: "${{documents.SECRET_ACCESS_KEY}}",
      SEED_OWNER_EMAIL: preserve(),
    },
  });

  // A cron service: Railway starts it on schedule, it runs once and exits. Schedules are in
  // UTC, so 01:00 is 08:00 in Bangkok. It schedules reminders, marks today's as due and
  // clears expired OAuth codes and tokens.
  const jobs = service("jobs", {
    source: REPO,
    build: {
      buildCommand: "pnpm turbo run build --filter=@ezvisa/core...",
      watchPatterns: ["/packages/**", "/pnpm-lock.yaml"],
    },
    start: "node packages/core/dist/scripts/daily.js",
    replicas: { [SINGAPORE]: 1 },
    deploy: { cronSchedule: "0 1 * * *", restartPolicyType: "NEVER" },
    env: {
      NODE_ENV: "production",
      DATABASE_URL: db.env.DATABASE_URL,
    },
  });

  // The live project's name, so an apply never renames the shared project.
  return project("considerate-vitality", { resources: [db, documents, ezvisa, jobs] });
});
