import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveShortCallToAction } from "@/lib/business/shorts";
import { ShortPlayer } from "./short-player";

export default async function ShortDetailPage({
  params,
}: {
  params: Promise<{ shortId: string }>;
}) {
  const { shortId } = await params;
  const short = await prisma.short.findUnique({ where: { id: shortId } });
  if (!short || short.status !== "PUBLISHED") notFound();

  const session = await auth();
  const studentId = session?.user.studentProfileId ?? null;

  const cta = await resolveShortCallToAction(prisma, { shortId, studentId });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-bold">{short.title}</h1>
      <ShortPlayer shortId={short.id} cta={cta} isLoggedIn={Boolean(session)} />
    </div>
  );
}
