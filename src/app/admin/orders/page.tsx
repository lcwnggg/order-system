import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import { getTransferBoard } from "@/lib/transfers";
import { getI18n } from "@/lib/i18n/server";
import OrdersClient, { type Order, type OrderItem } from "./orders-client";
import WarehouseTransferPanel from "./warehouse-transfer-panel";

export default async function AdminOrdersPage() {
  const { t } = await getI18n();
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
        `id, store_id, status, created_at, note,
         order_items ( id, quantity, variant_id, unit_price,
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

  const transferRequests = await getTransferBoard(supabase);

  const orders: Order[] = (rawOrders ?? []).map((o) => ({
    id: o.id as string,
    store_id: o.store_id as string,
    storeName: profileMap.get(o.store_id as string) ?? null,
    storeEmail: emailMap.get(o.store_id as string) ?? null,
    status: o.status as Order["status"],
    created_at: o.created_at as string,
    note: (o.note as string | null) ?? null,
    items: ((o.order_items as unknown[]) ?? []).map((raw) => {
      const item = raw as {
        id: string;
        quantity: number;
        variant_id: string | null;
        unit_price: number | null;
        products: { id: string; name: string; price: number; category_id: string | null };
      };
      return {
        id: item.id,
        quantity: item.quantity,
        product: item.products,
        // 下单时的价格快照；旧订单可能为空，回退到当前商品价
        unitPrice: item.unit_price ?? item.products.price,
        variantColor: item.variant_id ? variantColorMap.get(item.variant_id) ?? null : null,
      } satisfies OrderItem;
    }),
  }));

  return (
    <AppShell email={user.email}>
        <div className="mb-6 flex items-center justify-between">
          <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">{t("adminOrders.eyebrow")}</p>
          <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">{t("adminOrders.title")}</h1>
          <span className="text-sm text-paper-500">{t("adminOrders.countTotal", { n: orders.length })}</span>
        </div>
        <WarehouseTransferPanel requests={transferRequests} currentUserId={user.id} />
        <OrdersClient orders={orders} categories={categories} />
      </AppShell>
  );
}
