import { prisma } from "@/lib/prisma";
import { archiveCategory, createCategory } from "./actions";

type CategoryNode = {
  id: string;
  name: string;
  archived: boolean;
  children: CategoryNode[];
};

async function getCategoryTree(): Promise<CategoryNode[]> {
  const categories = await prisma.category.findMany({
    orderBy: { order: "asc" },
  });
  const byId = new Map<string, CategoryNode>(
    categories.map((c) => [c.id, { ...c, children: [] }]),
  );
  const roots: CategoryNode[] = [];
  for (const category of categories) {
    const node = byId.get(category.id)!;
    if (category.parentId && byId.has(category.parentId)) {
      byId.get(category.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function CategoryTreeItem({ node, depth }: { node: CategoryNode; depth: number }) {
  return (
    <div style={{ paddingInlineStart: depth * 20 }} className="border-b border-gray-100 py-2">
      <div className="flex items-center justify-between">
        <span className={node.archived ? "text-gray-500 line-through" : ""}>
          {node.name}
        </span>
        {!node.archived && (
          <form action={archiveCategory.bind(null, node.id)}>
            <button
              type="submit"
              className="text-xs text-red-600 hover:underline"
            >
              أرشفة
            </button>
          </form>
        )}
      </div>
      {node.children.map((child) => (
        <CategoryTreeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function flattenForSelect(
  nodes: CategoryNode[],
  depth = 0,
): { id: string; label: string }[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${"— ".repeat(depth)}${node.name}` },
    ...flattenForSelect(node.children, depth + 1),
  ]);
}

export default async function CategoriesPage() {
  const tree = await getCategoryTree();
  const flatOptions = flattenForSelect(tree);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">الأقسام والتصنيفات</h1>
      <p className="max-w-2xl text-sm text-gray-600">
        الهيكل التعليمي بالكامل مرن ويحدده المعلم — يمكن إنشاء أي تسلسل
        (مراحل، وحدات، مواد) بدون أي افتراضات مسبقة في النظام.
      </p>

      <form
        action={createCategory}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">اسم القسم</span>
          <input
            name="name"
            required
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-gray-600">القسم الأب (اختياري)</span>
          <select
            name="parentId"
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            <option value="">— بدون —</option>
            {flatOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
        >
          إضافة قسم
        </button>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        {tree.length === 0 ? (
          <p className="text-sm text-gray-500">لا توجد أقسام بعد.</p>
        ) : (
          tree.map((node) => <CategoryTreeItem key={node.id} node={node} depth={0} />)
        )}
      </div>
    </div>
  );
}
