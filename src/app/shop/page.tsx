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

  const [{ data: products }, { data: categoriesData }, { data: lastOrders }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, description, price, stock, image_url, category_id")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("orders")
      .select("order_items(product_id, quantity)")
      .eq("store_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const lastOrderItems =
    (lastOrders?.[0]?.order_items ?? []) as { product_id: string; quantity: number }[];

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              ← 返回首页
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-semibold text-zinc-900">门店下单</span>
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

      <ShopClient
        products={products ?? []}
        categories={(categoriesData ?? []) as { id: string; name: string; parent_id: string | null }[]}
        lastOrderItems={lastOrderItems}
      />
    </div>
  );
}
