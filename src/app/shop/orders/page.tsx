import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import OrdersHistoryClient, { type StoreOrder } from "./orders-history-client";

export default async function ShopOrdersPage() {
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

  if (profile?.role === "warehouse") redirect("/admin/orders");
  if (profile?.role !== "store") redirect("/login");

  const { data: rawOrders } = await supabase
    .from("orders")
    .select(
      `id, status, created_at, note,
       order_items ( id, quantity, variant_id, unit_price,
         products ( id, name, price )
       )`
    )
    .eq("store_id", user.id)
    .order("created_at", { ascending: false });

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

  const orders: StoreOrder[] = (rawOrders ?? []).map((o) => ({
    id: o.id as string,
    status: o.status as StoreOrder["status"],
    created_at: o.created_at as string,
    note: (o.note as string | null) ?? null,
    items: ((o.order_items as unknown[]) ?? []).map((raw) => {
      const item = raw as {
        id: string;
        quantity: number;
        variant_id: string | null;
        unit_price: number | null;
        products: { id: string; name: string; price: number };
      };
      return {
        id: item.id,
        productId: item.products.id,
        name: item.products.name,
        // 下单时的价格快照；旧订单可能为空，回退到当前商品价
        price: item.unit_price ?? item.products.price,
        quantity: item.quantity,
        variantId: item.variant_id,
        variantColor: item.variant_id ? variantColorMap.get(item.variant_id) ?? null : null,
      };
    }),
  }));

  return (
    <AppShell variant="store" email={user.email}>
      <div className="flex items-center gap-3">
        <Link href="/shop" className="text-sm text-paper-500 transition-colors hover:text-paper-900">
          ← 返回下单
        </Link>
        <span className="text-paper-400">/</span>
        <h1 className="text-sm font-semibold text-paper-900">我的订单</h1>
      </div>
      <OrdersHistoryClient orders={orders} />
    </AppShell>
  );
}
