import { prisma } from "@/lib/prisma";

export default async function TeacherDashboardPage() {
  const [studentCount, courseCount, activeSubscriptions, openTickets] =
    await Promise.all([
      prisma.studentProfile.count(),
      prisma.course.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    ]);

  const cards = [
    { label: "إجمالي الطلاب", value: studentCount },
    { label: "الكورسات", value: courseCount },
    { label: "الاشتراكات الفعّالة", value: activeSubscriptions },
    { label: "تذاكر دعم مفتوحة", value: openTickets },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">لوحة تحكم المعلم</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          >
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
