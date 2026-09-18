import { defineConfig } from "prisma/config";
import path from "node:path";
import fs from "node:fs";

// Prisma 6's config-file mode intentionally stops auto-loading `.env` (it
// expects the caller to do so). We load it ourselves here so `npx prisma
// migrate dev`, `db:studio`, etc. keep working the same way they did before
// prisma.config.ts existed, without requiring every caller to remember to
// export DATABASE_URL first.
function loadDotEnvIfPresent(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (process.env[key] !== undefined) continue; // real env vars always win
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    process.env[key] = value;
  }
}

loadDotEnvIfPresent(path.join(process.cwd(), ".env"));

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
