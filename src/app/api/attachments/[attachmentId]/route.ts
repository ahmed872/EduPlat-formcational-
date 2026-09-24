import { Readable } from "node:stream";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { authorizeAttachmentDownload, contentDisposition } from "@/lib/business/attachments";
import { getAttachmentStorageProvider } from "@/lib/storage/provider";

/**
 * The only way to read a lesson attachment's bytes. Uses auth()'s
 * middleware form so the session comes straight from the request cookies
 * (testable in Vitest). See authorizeAttachmentDownload for the rules.
 * Always served as a download with nosniff + a sandbox CSP, so an uploaded
 * file can never execute as a page on this origin.
 */
export const GET = auth(async function GET(request, context) {
  const { attachmentId } = (await context.params) as { attachmentId: string };
  const decision = await authorizeAttachmentDownload(prisma, {
    attachmentId,
    token: request.nextUrl.searchParams.get("token"),
    session: request.auth?.user,
  });
  if (!decision.ok) return new Response(decision.message, { status: decision.status });

  const storage = getAttachmentStorageProvider();
  let size: number;
  try {
    size = await storage.getSize(decision.attachment.storageKey);
  } catch {
    return new Response("File is not available", { status: 404 });
  }
  const stream = storage.readStream(decision.attachment.storageKey);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": decision.attachment.mimeType,
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(decision.attachment.originalName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
});
