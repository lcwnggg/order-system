import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import AdminNav from "@/app/admin/admin-nav";
import AddProductPanel from "./add-product-panel";
import ProductList, { type Product } from "./product-list";
import type { Category } from "@/app/admin/categories/categories-client";
import type { ProductVariant } from "./actions";

export default async function AdminProductsPage() {
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

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .order("name");

  const { data: categoriesData } = await supabase
    .from("categories")
    .select("id, name, parent_id, sort_order")
    .order("sort_order")
    .order("created_at");

  const { data: productVariantsData } = await supabase
    .from("product_variants")
    .select("id, product_id, color, stock, sort_order")
    .order("sort_order");

  const categories = (categoriesData ?? []) as Category[];
  const productVariants = (productVariantsData ?? []) as ProductVariant[];

  return (
    <div className="min-h-screen bg-paper-100">
      <header className="border-b border-paper-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <AdminNav />
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-paper-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-paper-200 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-paper-100"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <AddProductPanel categories={categories} />

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-paper-900">
              已添加商品
              {products && products.length > 0 && (
                <span className="ml-2 text-sm font-normal text-paper-500">
                  共 {products.length} 件
                </span>
              )}
            </h2>
            <Link
              href="/admin/products/import"
              className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
            >
              批量导入 →
            </Link>
          </div>

          <ProductList products={(products ?? []) as Product[]} categories={categories} variants={productVariants} />
        </div>
      </main>
    </div>
  );
}
