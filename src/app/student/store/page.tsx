import { prisma } from "@/lib/prisma";
import { listActiveProducts } from "@/lib/business/store";
import { StoreClient } from "./store-client";

export default async function StudentStorePage() {
  const products = await listActiveProducts(prisma);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">المتجر</h1>
        <p className="mt-1 text-sm text-gray-600">
          الكمية المعروضة حقيقية — لا يمكنك طلب أكثر مما هو متوفر فعليًا.
        </p>
      </div>
      <StoreClient products={products} />
    </div>
  );
}
