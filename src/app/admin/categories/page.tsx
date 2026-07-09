import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import CategoriesClient, { type Category, type CategoryTree, type ProductSummary } from "./categories-client";

export default async function AdminCategoriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "warehouse") redirect("/login");

  const { data: allCategories } = await supabase
    .from("categories")
    .select("id, name, parent_id, sort_order")
    .order("sort_order")
    .order("created_at");

  const { data: productsData } = await supabase
    .from("products")
    .select("id, name, category_id")
    .order("name");

  const flat = (allCategories ?? []) as Category[];
  const parents = flat.filter((c) => !c.parent_id);
  const categoryTree: CategoryTree[] = parents.map((p) => ({
    ...p,
    children: flat.filter((c) => c.parent_id === p.id),
  }));

  const products = (productsData ?? []) as ProductSummary[];

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              ← 首页
            </Link>
            <span className="text-zinc-300">/</span>
            <Link href="/admin/products" className="text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              商品管理
            </Link>
            <span className="text-zinc-300">/</span>
            <Link href="/admin/orders" className="text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              订单管理
            </Link>
            <span className="text-zinc-300">/</span>
            <Link href="/admin/stores" className="text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              门店管理
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-semibold text-zinc-900">分类管理</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">分类管理</h1>
          <p className="mt-1 text-sm text-zinc-400">
            管理两级商品分类目录（大类 › 小类），商品可归属到任意小类。
          </p>
        </div>
        <CategoriesClient categoryTree={categoryTree} products={products} />
      </main>
    </div>
  );
}
