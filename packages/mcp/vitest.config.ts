import { defineConfig } from "vitest/config";

// Workspace packages are read from their TypeScript source and processed by Vite,
// not loaded by Node from dist (which may not be built yet). Vitest sets resolve
// options per environment ("ssr" for tests, "__vitest__" for global setup), so the
// source condition is declared on both.
const workspace = [/^@ezvisa\//];
const resolve = {
  conditions: ["@ezvisa/source", "node", "development|production"],
  noExternal: workspace,
};

export default defineConfig({
  environments: {
    ssr: { resolve },
    __vitest__: { resolve },
  },
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    server: { deps: { inline: workspace } },
    // Database tests share one test database, so files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
