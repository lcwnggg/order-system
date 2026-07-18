import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import AdminNav from "@/app/admin/admin-nav";
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
    <div className="relative min-h-screen">
      <div className="app-bg" />
      <div className="app-grain" />
      <header className="glass sticky top-0 z-30 px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <AdminNav />
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-paper-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-white/50 bg-white/40 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-white/70"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">仓库 — 分类</p>
          <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">分类管理</h1>
          <p className="mt-1 text-sm text-paper-500">
            管理两级商品分类目录（大类 › 小类），商品可归属到任意小类。
          </p>
        </div>
        <CategoriesClient categoryTree={categoryTree} products={products} variants={variants} />
      </main>
    </div>
  );
}
