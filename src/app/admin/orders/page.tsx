import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import OrdersClient, { type Order, type OrderItem } from "./orders-client";

export default async function AdminOrdersPage() {
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

  // 拉取所有订单，嵌套商品明细
  const [{ data: rawOrders }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `id, store_id, status, created_at,
         order_items ( id, quantity, variant_id,
           products ( id, name, price, category_id )
         )`
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .order("sort_order")
      .order("created_at"),
  ]);
  const categories = (categoriesData ?? []) as { id: string; name: string; parent_id: string | null }[];

  // 单独取变体颜色（不依赖 order_items→product_variants 的 FK 嵌套关系）
  const variantIds = [
    ...new Set(
      (rawOrders ?? [])
        .flatMap((o) => (o.order_items as { variant_id: string | null }[] | null) ?? [])
        .map((it) => it.variant_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const { data: variantRows } =
    variantIds.length > 0
      ? await supabase.from("product_variants").select("id, color").in("id", variantIds)
      : { data: [] };
  const variantColorMap = new Map(
    (variantRows ?? []).map((v) => [v.id as string, v.color as string])
  );

  // 拉取下单门店的 profile（store_name）+ email（via RPC）
  const storeIds = [...new Set((rawOrders ?? []).map((o) => o.store_id as string))];
  const { data: storeProfiles } =
    storeIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, store_name")
          .in("id", storeIds)
      : { data: [] };

  const profileMap = new Map(
    (storeProfiles ?? []).map((p) => [p.id as string, p.store_name as string | null])
  );

  // get_store_users() 是 SECURITY DEFINER RPC，能读到 auth.users.email
  const emailMap = new Map<string, string>();
  const { data: storeUsers } = await supabase.rpc("get_store_users");
  if (storeUsers) {
    for (const u of storeUsers as { id: string; email: string }[]) {
      emailMap.set(u.id, u.email);
    }
  }

  const orders: Order[] = (rawOrders ?? []).map((o) => ({
    id: o.id as string,
    store_id: o.store_id as string,
    storeName: profileMap.get(o.store_id as string) ?? null,
    storeEmail: emailMap.get(o.store_id as string) ?? null,
    status: o.status as Order["status"],
    created_at: o.created_at as string,
    items: ((o.order_items as unknown[]) ?? []).map((raw) => {
      const item = raw as {
        id: string;
        quantity: number;
        variant_id: string | null;
        products: { id: string; name: string; price: number; category_id: string | null };
      };
      return {
        id: item.id,
        quantity: item.quantity,
        product: item.products,
        variantColor: item.variant_id ? variantColorMap.get(item.variant_id) ?? null : null,
      } satisfies OrderItem;
    }),
  }));

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link
              href="/"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              ← 返回首页
            </Link>
            <span className="text-zinc-300">/</span>
            <Link
              href="/admin/products"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              商品管理
            </Link>
            <span className="text-zinc-300">/</span>
            <Link
              href="/admin/stores"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              门店管理
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-semibold text-zinc-900">订单管理</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:block">{user.email}</span>
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
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-900">订单管理</h1>
          <span className="text-sm text-zinc-400">共 {orders.length} 笔订单</span>
        </div>
        <OrdersClient orders={orders} categories={categories} />
      </main>
    </div>
  );
}
