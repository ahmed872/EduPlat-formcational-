import { validateServerEnv } from "@/lib/env";
import { checkPrivateStorageWritable } from "@/lib/storage/provider";

/** See src/instrumentation.ts. Never prints secret values. */
export async function runStartupChecks() {
  const { errors, warnings } = validateServerEnv(process.env);
  errors.push(...(await checkPrivateStorageWritable()));

  for (const warning of warnings) console.warn(`[startup] warning: ${warning}`);
  if (errors.length === 0) {
    console.log("[startup] configuration and private storage checks passed");
    return;
  }
  for (const error of errors) console.error(`[startup] error: ${error}`);
  if (process.env.NODE_ENV === "production") {
    console.error("[startup] refusing to start — fix the configuration above (see DEPLOYMENT.md)");
    process.exit(1);
  }
}
