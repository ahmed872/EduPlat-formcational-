import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function ParentDashboardPage() {
  const session = await auth();
  const parentProfile = await prisma.parentProfile.findUnique({
    where: { userId: session!.user.id },
    include: {
      children: {
        include: {
          student: {
            include: {
              user: true,
              dailyStudyStats: true,
              streak: true,
            },
          },
        },
      },
    },
  });

  const children = parentProfile?.children ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-bold">أبنائي</h1>
      {children.length === 0 && (
        <p className="text-sm text-gray-500">
          لا يوجد أبناء مرتبطين بحسابك بعد. تواصل مع إدارة المنصة لربط حساب
          ابنك/ابنتك.
        </p>
      )}
      {children.map(({ student }) => {
        const totalSeconds = student.dailyStudyStats.reduce(
          (sum, s) => sum + s.totalActiveSeconds,
          0,
        );
        return (
          <div key={student.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="font-semibold">{student.user.name}</h2>
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm text-gray-600 md:grid-cols-3">
              <p>إجمالي وقت المذاكرة: {Math.round(totalSeconds / 60)} دقيقة</p>
              <p>السلسلة الحالية: {student.streak?.currentStreak ?? 0} يوم</p>
              <p>أطول سلسلة: {student.streak?.longestStreak ?? 0} يوم</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
