import Link from "next/link";
import { redirect } from "next/navigation";
import { denyPage, requireRole } from "@/lib/supabase/guard";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import OrdersHistoryClient, { type StoreOrder } from "./orders-history-client";

export default async function ShopOrdersPage() {
  const { t } = await getI18n();
  const guard = await requireRole("store", "warehouse");
  if ("error" in guard) denyPage(guard, t);
  const { supabase, user, profile } = guard;

  if (profile.role === "warehouse") redirect("/admin/orders");

  const { data: rawOrders } = await supabase
    .from("orders")
    .select(
      `id, status, created_at, note,
       order_items ( id, quantity, variant_id, unit_price,
         products ( id, name, price, image_url )
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

  // Líneas escritas a mano de estos pedidos. Consulta aparte a propósito: si el
  // script supabase/order_custom_items.sql todavía no se ha ejecutado, esta
  // falla sola y el historial se sigue viendo (anidarla rompería la consulta
  // principal).
  const orderIds = (rawOrders ?? []).map((o) => o.id as string);
  const { data: writtenRows } =
    orderIds.length > 0
      ? await supabase
          .from("order_custom_items")
          .select("id, order_id, description, quantity")
          .in("order_id", orderIds)
          .order("created_at")
      : { data: [] };
  const writtenByOrder = new Map<string, { id: string; description: string; quantity: number }[]>();
  for (const row of (writtenRows ?? []) as {
    id: string;
    order_id: string;
    description: string;
    quantity: number;
  }[]) {
    const list = writtenByOrder.get(row.order_id) ?? [];
    list.push({ id: row.id, description: row.description, quantity: row.quantity });
    writtenByOrder.set(row.order_id, list);
  }

  const orders: StoreOrder[] = (rawOrders ?? []).map((o) => ({
    id: o.id as string,
    status: o.status as StoreOrder["status"],
    created_at: o.created_at as string,
    note: (o.note as string | null) ?? null,
    writtenItems: writtenByOrder.get(o.id as string) ?? [],
    items: ((o.order_items as unknown[]) ?? []).map((raw) => {
      const item = raw as {
        id: string;
        quantity: number;
        variant_id: string | null;
        unit_price: number | null;
        products: { id: string; name: string; price: number; image_url: string | null };
      };
      return {
        id: item.id,
        productId: item.products.id,
        name: item.products.name,
        imageUrl: item.products.image_url ?? null,
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
          {t("myOrders.backToShop")}
        </Link>
        <span className="text-paper-400">/</span>
        <h1 className="text-sm font-semibold text-paper-900">{t("nav.myOrders")}</h1>
      </div>
      <OrdersHistoryClient orders={orders} />
    </AppShell>
  );
}
