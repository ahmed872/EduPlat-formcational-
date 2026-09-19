"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { checkout } from "./actions";

type Product = {
  id: string;
  title: string;
  description: string | null;
  priceCents: number;
  stock: number;
};

export function StoreClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function addToCart(productId: string) {
    setSuccess(false);
    setCart((prev) => {
      const product = productById.get(productId);
      const current = prev[productId] ?? 0;
      const max = product?.stock ?? 0;
      return { ...prev, [productId]: Math.min(current + 1, max) };
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => {
      const next = { ...prev };
      const current = (next[productId] ?? 0) - 1;
      if (current <= 0) delete next[productId];
      else next[productId] = current;
      return next;
    });
  }

  const cartEntries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const totalCents = cartEntries.reduce((sum, [productId, qty]) => {
    const product = productById.get(productId);
    return sum + (product ? product.priceCents * qty : 0);
  }, 0);

  async function handleCheckout() {
    setSubmitting(true);
    setError(null);
    try {
      await checkout(cartEntries.map(([productId, quantity]) => ({ productId, quantity })));
      setCart({});
      setSuccess(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إتمام الطلب");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {products.map((product) => {
          const inCart = cart[product.id] ?? 0;
          return (
            <div key={product.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="font-semibold">{product.title}</p>
              {product.description && <p className="mt-1 text-xs text-gray-500">{product.description}</p>}
              <p className="mt-2 text-sm font-bold text-indigo-600">
                {(product.priceCents / 100).toFixed(2)} جنيه
              </p>
              <p className="text-xs text-gray-400">متبقي: {product.stock}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => removeFromCart(product.id)}
                  disabled={inCart === 0}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm">{inCart}</span>
                <button
                  type="button"
                  onClick={() => addToCart(product.id)}
                  disabled={inCart >= product.stock}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
        {products.length === 0 && (
          <p className="col-span-full text-sm text-gray-500">لا توجد منتجات متاحة حاليًا.</p>
        )}
      </div>

      {cartEntries.length > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <p className="font-semibold">سلتك</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {cartEntries.map(([productId, qty]) => (
              <li key={productId}>
                {productById.get(productId)?.title} × {qty}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-bold">الإجمالي: {(totalCents / 100).toFixed(2)} جنيه</p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={handleCheckout}
            disabled={submitting}
            className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {submitting ? "جارٍ الإرسال..." : "إتمام الطلب"}
          </button>
        </div>
      )}
      {success && (
        <p className="text-sm text-green-700">
          تم إرسال طلبك! يمكنك متابعة حالته من صفحة &quot;طلباتي&quot;.
        </p>
      )}
    </div>
  );
}
