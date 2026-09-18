import { execSync } from "node:child_process";
import { loadTestEnv } from "./env";

export default async function globalSetup() {
  loadTestEnv();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
}
