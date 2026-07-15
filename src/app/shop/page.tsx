import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import ShopClient from "./shop-client";

export default async function ShopPage() {
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

  if (profile?.role === "warehouse") redirect("/admin/products");
  if (profile?.role !== "store") redirect("/login");

  const [{ data: products }, { data: categoriesData }, { data: lastOrders }, { data: variantsData }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, description, price, stock, image_url, category_id, has_variants, brand, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("orders")
      .select("order_items(product_id, variant_id, quantity)")
      .eq("store_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("product_variants")
      .select("id, product_id, color, stock, sort_order")
      .order("sort_order"),
  ]);

  const lastOrderItems =
    (lastOrders?.[0]?.order_items ?? []) as { product_id: string; variant_id: string | null; quantity: number }[];

  return (
    <div className="min-h-screen bg-paper-100">
      <header className="border-b border-paper-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-paper-500 transition-colors hover:text-paper-900"
            >
              ← 返回首页
            </Link>
            <span className="text-paper-400">/</span>
            <span className="text-sm font-semibold text-paper-900">门店下单</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/shop/orders"
              className="rounded-lg border border-paper-200 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-paper-100"
            >
              我的订单
            </Link>
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

      {/* 编辑风页头：mono 印章 + display 标题 */}
      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
        <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.24em] text-paper-500">
          B2B 订货目录 — {products?.length ?? 0} 件商品
        </p>
        <h1 className="animate-fade-up mt-3 text-4xl font-normal tracking-tight text-paper-900 sm:text-5xl">
          挑选商品，一键下单。
        </h1>
      </div>

      <ShopClient
        products={products ?? []}
        categories={(categoriesData ?? []) as { id: string; name: string; parent_id: string | null }[]}
        lastOrderItems={lastOrderItems}
        variants={(variantsData ?? []) as { id: string; product_id: string; color: string; stock: number; sort_order: number }[]}
      />
    </div>
  );
}
