import { prisma } from "@/lib/prisma";
import { createProduct, restockProduct, toggleProductStatus } from "./actions";

export default async function TeacherProductsPage() {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">منتجات المتجر</h1>
        <p className="mt-1 text-sm text-gray-600">
          الكمية تنقص فعليًا مع كل طلب حقيقي — لا يمكن بيع أكثر من المخزون الفعلي.
        </p>
      </div>

      <form
        action={createProduct}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اسم المنتج</span>
          <input name="title" required className="min-w-56 rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الوصف (اختياري)</span>
          <input name="description" className="min-w-56 rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">السعر (جنيه)</span>
          <input type="number" name="price" min="0" step="0.01" required className="w-28 rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">الكمية المتوفرة</span>
          <input type="number" name="stock" min="0" required className="w-24 rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">
          إضافة منتج
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-right text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">المنتج</th>
              <th className="px-4 py-2">السعر</th>
              <th className="px-4 py-2">المخزون</th>
              <th className="px-4 py-2">الحالة</th>
              <th className="px-4 py-2">إعادة تخزين</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{product.title}</td>
                <td className="px-4 py-2">{(product.priceCents / 100).toFixed(2)} جنيه</td>
                <td className="px-4 py-2">{product.stock}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      product.status === "PUBLISHED"
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                        : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    }
                  >
                    {product.status === "PUBLISHED" ? "معروض" : "غير معروض"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <form action={restockProduct.bind(null, product.id)} className="flex gap-1">
                    <input
                      type="number"
                      name="amount"
                      min="1"
                      placeholder="كمية"
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button type="submit" className="rounded-md bg-gray-200 px-2 py-1 text-xs hover:bg-gray-300">
                      إضافة
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2">
                  <form action={toggleProductStatus.bind(null, product.id, product.status)}>
                    <button type="submit" className="text-xs text-indigo-600 hover:underline">
                      {product.status === "PUBLISHED" ? "إخفاء" : "عرض"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td className="px-4 py-2 text-gray-500" colSpan={6}>
                  لا توجد منتجات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
