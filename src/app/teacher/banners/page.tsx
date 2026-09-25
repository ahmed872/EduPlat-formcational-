import { prisma } from "@/lib/prisma";
import { createBanner, deleteBanner, toggleBannerActive } from "./actions";

export default async function TeacherBannersPage() {
  const banners = await prisma.marketingBanner.findMany({
    orderBy: { order: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">إعلانات الصفحة الرئيسية</h1>
        <p className="mt-1 text-sm text-gray-600">
          تظهر هذه الإعلانات لكل زائر على الصفحة الرئيسية العامة — استخدمها
          للترويج لخصومات (عبر كود خصم موجود) أو كورسات جديدة.
        </p>
      </div>

      <form
        action={createBanner}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">العنوان</span>
          <input
            name="title"
            required
            className="min-w-56 rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-1 basis-full flex-col gap-1">
          <span className="text-sm text-gray-600">النص (اختياري)</span>
          <textarea
            name="body"
            rows={2}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">نص الزر (اختياري)</span>
          <input name="ctaLabel" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">رابط الزر (اختياري)</span>
          <input
            name="ctaHref"
            placeholder="/register"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">يبدأ من (اختياري)</span>
          <input
            type="datetime-local"
            name="startsAt"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">ينتهي في (اختياري)</span>
          <input
            type="datetime-local"
            name="endsAt"
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إضافة إعلان
        </button>
      </form>

      <div className="flex flex-col gap-3">
        {banners.map((banner) => (
          <div
            key={banner.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4"
          >
            <div>
              <p className="font-semibold">{banner.title}</p>
              {banner.body && <p className="text-sm text-gray-600">{banner.body}</p>}
              <p className="mt-1 text-xs text-gray-500">
                {banner.startsAt && `من ${banner.startsAt.toLocaleString("ar-EG")} `}
                {banner.endsAt && `إلى ${banner.endsAt.toLocaleString("ar-EG")}`}
                {!banner.startsAt && !banner.endsAt && "بدون حدود زمنية"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={
                  banner.active
                    ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                }
              >
                {banner.active ? "مفعّل" : "متوقف"}
              </span>
              <form action={toggleBannerActive.bind(null, banner.id, banner.active)}>
                <button type="submit" className="text-xs text-indigo-600 hover:underline">
                  {banner.active ? "إيقاف" : "تفعيل"}
                </button>
              </form>
              <form action={deleteBanner.bind(null, banner.id)}>
                <button type="submit" className="text-xs text-red-600 hover:underline">
                  حذف
                </button>
              </form>
            </div>
          </div>
        ))}
        {banners.length === 0 && (
          <p className="text-sm text-gray-500">لا توجد إعلانات بعد.</p>
        )}
      </div>
    </div>
  );
}
