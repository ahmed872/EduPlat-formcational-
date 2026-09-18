import fs from "node:fs";
import path from "node:path";

let loaded = false;

/** Minimal .env.test loader so tests run against the isolated test database. */
export function loadTestEnv() {
  if (loaded) return;
  loaded = true;

  const envPath = path.join(process.cwd(), ".env.test");
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    process.env[key] = value;
  }
}
