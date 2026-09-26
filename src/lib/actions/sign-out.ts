"use server";

import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revokeSession } from "@/lib/business/session-validity";

/**
 * Sign out on this device. Revokes the session server-side first, so a
 * refreshed session cookie delivered by a request that was still in flight
 * can't sign the user back in; then clears this browser's cookie.
 */
export async function signOutThisDevice() {
  const session = await auth();
  if (session?.sessionId && session.user?.id) {
    await revokeSession(prisma, { sid: session.sessionId, userId: session.user.id });
  }
  await signOut({ redirectTo: "/" });
}
