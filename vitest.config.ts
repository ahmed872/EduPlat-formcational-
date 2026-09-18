import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    // Next's package.json has no "exports" map, so its ESM files must be
    // resolved with an explicit extension; Vite's strict ESM resolver
    // needs a nudge here that Next's own bundler doesn't (route handlers
    // and next-auth both import bare "next/server" internally).
    alias: [{ find: /^next\/server$/, replacement: "next/server.js" }],
  },
  ssr: {
    // Without this, Vitest externalizes next-auth and lets Node's native
    // ESM loader resolve its imports directly, bypassing the alias above.
    noExternal: ["next-auth", "@auth/core"],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup-env.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    fileParallelism: false,
  },
});
