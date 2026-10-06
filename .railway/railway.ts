import { bucket, defineRailway, github, postgres, project, service } from "railway/iac";

// EzVisa on Railway, Singapore. See docs/04-mvp-spec.md section 12.
// Preview with `railway config plan`; changes are applied from pull requests.

const SINGAPORE = "asia-southeast1-eqsg3a";

export default defineRailway(() => {
  const db = postgres("postgres");
  const documents = bucket("documents", { region: "sin" });
  const backup = bucket("documents-backup", { region: "sin" });

  const server = service("server", {
    source: github("fabiensabatie/ezvisa", { branch: "main" }),
    build: "pnpm turbo run build --filter=@ezvisa/server... --filter=@ezvisa/web...",
    preDeploy: "pnpm --filter @ezvisa/db migrate:deploy",
    start: "pnpm --filter @ezvisa/server start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { [SINGAPORE]: 1 },
    // Add the custom domain here once it is chosen (spec, open question 1).
    domains: [],
    env: {
      NODE_ENV: "production",
      APP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      DATABASE_URL: db.env.DATABASE_URL,
      S3_ENDPOINT: "${{documents.ENDPOINT}}",
      S3_REGION: "${{documents.REGION}}",
      S3_BUCKET: "${{documents.BUCKET}}",
      S3_ACCESS_KEY_ID: "${{documents.ACCESS_KEY_ID}}",
      S3_SECRET_ACCESS_KEY: "${{documents.SECRET_ACCESS_KEY}}",
      BACKUP_S3_ENDPOINT: "${{documents-backup.ENDPOINT}}",
      BACKUP_S3_REGION: "${{documents-backup.REGION}}",
      BACKUP_S3_BUCKET: "${{documents-backup.BUCKET}}",
      BACKUP_S3_ACCESS_KEY_ID: "${{documents-backup.ACCESS_KEY_ID}}",
      BACKUP_S3_SECRET_ACCESS_KEY: "${{documents-backup.SECRET_ACCESS_KEY}}",
    },
  });

  return project("ezvisa", { resources: [db, documents, backup, server] });
});
