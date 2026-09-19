import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertCanViewTicket, getTicketWithThread } from "@/lib/business/support";
import { ForbiddenError } from "@/lib/rbac";
import { addReply } from "../actions";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "مفتوحة",
  IN_PROGRESS: "قيد المعالجة",
  WAITING: "بانتظار ردك",
  RESOLVED: "تم الحل",
  CLOSED: "مغلقة",
};

export default async function ParentTicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const session = await auth();
  const ticket = await getTicketWithThread(prisma, ticketId);
  if (!ticket) notFound();

  try {
    assertCanViewTicket(ticket, session!.user);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{ticket.subject}</h1>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
          {STATUS_LABELS[ticket.status]}
        </span>
      </div>
      {ticket.student && (
        <p className="text-sm text-gray-500">بخصوص: {ticket.student.user.name}</p>
      )}

      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">{ticket.author.name}</p>
          <p className="mt-1 text-sm">{ticket.description}</p>
        </div>
        {ticket.replies.map((reply) => (
          <div
            key={reply.id}
            className={`rounded-lg border p-3 ${
              reply.authorId === ticket.authorId
                ? "border-gray-200 bg-white"
                : "border-indigo-200 bg-indigo-50"
            }`}
          >
            <p className="text-xs text-gray-500">{reply.author.name}</p>
            <p className="mt-1 text-sm">{reply.body}</p>
          </div>
        ))}
      </div>

      {ticket.status !== "CLOSED" && (
        <form action={addReply.bind(null, ticket.id)} className="flex flex-col gap-2">
          <textarea
            name="body"
            required
            rows={3}
            placeholder="اكتب ردك..."
            className="rounded-md border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            className="w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            إرسال الرد
          </button>
        </form>
      )}
    </div>
  );
}
