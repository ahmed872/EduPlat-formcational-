import type { ContentStatus } from "@prisma/client";
import type { ContentKind } from "@/lib/business/content-status";
import { setCourseContentStatus } from "../actions";

const LABELS: Record<ContentStatus, string> = {
  PUBLISHED: "منشور",
  DRAFT: "غير منشور",
  ARCHIVED: "مؤرشف",
};

const BADGE: Record<ContentStatus, string> = {
  PUBLISHED: "bg-green-100 text-green-700",
  DRAFT: "bg-gray-100 text-gray-600",
  ARCHIVED: "bg-amber-100 text-amber-800",
};

const ACTIONS: { status: ContentStatus; label: string }[] = [
  { status: "PUBLISHED", label: "نشر" },
  { status: "DRAFT", label: "إلغاء النشر" },
  { status: "ARCHIVED", label: "أرشفة" },
];

export function StatusControls({
  courseId,
  kind,
  id,
  status,
  publishLabel,
}: {
  courseId: string;
  kind: ContentKind;
  id: string;
  status: ContentStatus;
  publishLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2" data-status-controls={`${kind}:${id}`}>
      <span className={`rounded-full px-2 py-0.5 text-xs ${BADGE[status]}`} data-status={status}>
        {LABELS[status]}
      </span>
      {ACTIONS.filter((a) => a.status !== status).map((action) => (
        <form
          key={action.status}
          action={setCourseContentStatus.bind(null, courseId, kind, id, action.status)}
        >
          <button
            type="submit"
            data-action={action.status}
            className={
              action.status === "PUBLISHED"
                ? "text-xs text-indigo-600 hover:underline"
                : action.status === "ARCHIVED"
                  ? "text-xs text-amber-700 hover:underline"
                  : "text-xs text-gray-600 hover:underline"
            }
          >
            {action.status === "PUBLISHED" && publishLabel ? publishLabel : action.label}
          </button>
        </form>
      ))}
    </div>
  );
}
