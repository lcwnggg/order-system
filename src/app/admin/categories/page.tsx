import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import CategoriesClient, { type Category, type CategoryTree, type ProductSummary } from "./categories-client";
import type { ProductVariant } from "@/app/admin/products/actions";

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

  const [{ data: productsData }, { data: variantsData }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category_id, price, stock, description, image_url, is_active, has_variants, brand, barcode, created_at")
      .order("name"),
    supabase
      .from("product_variants")
      .select("id, product_id, color, stock, sort_order")
      .order("sort_order"),
  ]);

  const flat = (allCategories ?? []) as Category[];
  const parents = flat.filter((c) => !c.parent_id);
  const categoryTree: CategoryTree[] = parents.map((p) => ({
    ...p,
    children: flat.filter((c) => c.parent_id === p.id),
  }));

  const products = (productsData ?? []) as ProductSummary[];
  const variants = (variantsData ?? []) as ProductVariant[];

  return (
    <div className="min-h-screen bg-sage-100">
      <header className="border-b border-sage-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link href="/" className="text-sm text-sage-500 transition-colors hover:text-sage-900">
              ← 首页
            </Link>
            <span className="text-sage-400">/</span>
            <Link href="/admin/products" className="text-sm text-sage-500 transition-colors hover:text-sage-900">
              商品管理
            </Link>
            <span className="text-sage-400">/</span>
            <Link href="/admin/orders" className="text-sm text-sage-500 transition-colors hover:text-sage-900">
              订单管理
            </Link>
            <span className="text-sage-400">/</span>
            <Link href="/admin/stores" className="text-sm text-sage-500 transition-colors hover:text-sage-900">
              门店管理
            </Link>
            <span className="text-sage-400">/</span>
            <span className="text-sm font-semibold text-sage-900">分类管理</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-sage-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-sage-200 px-3 py-1.5 text-sm text-sage-700 transition-colors hover:bg-sage-100"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-sage-900">分类管理</h1>
          <p className="mt-1 text-sm text-sage-500">
            管理两级商品分类目录（大类 › 小类），商品可归属到任意小类。
          </p>
        </div>
        <CategoriesClient categoryTree={categoryTree} products={products} variants={variants} />
      </main>
    </div>
  );
}
