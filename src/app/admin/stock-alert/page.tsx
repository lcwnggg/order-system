import { denyPage, requireRole } from "@/lib/supabase/guard";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import { getTotalStock, isLowStock } from "@/lib/stock";
import StockAlertClient from "./stock-alert-client";

export default async function StockAlertPage() {
  const { t } = await getI18n();
  const guard = await requireRole("warehouse");
  if ("error" in guard) denyPage(guard, t);
  const { supabase, user } = guard;

  const [{ data: products }, { data: variantsData }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, stock, image_url, is_active, has_variants")
      .order("name"),
    supabase
      .from("product_variants")
      .select("id, product_id, color, stock, sort_order")
      .order("sort_order"),
  ]);

  const variantsByProduct = new Map<
    string,
    { id: string; color: string; stock: number }[]
  >();
  for (const v of variantsData ?? []) {
    const arr = variantsByProduct.get(v.product_id) ?? [];
    arr.push({ id: v.id, color: v.color, stock: v.stock });
    variantsByProduct.set(v.product_id, arr);
  }

  // 按统一库存口径筛出告急商品：无变体看 products.stock，有变体看任一颜色 ≤5
  const list = (products ?? [])
    .map((p) => {
      const variants = variantsByProduct.get(p.id) ?? [];
      return { ...p, variants, totalStock: getTotalStock(p, variants) };
    })
    .filter((p) => isLowStock(p, p.variants))
    .sort((a, b) => a.totalStock - b.totalStock || a.name.localeCompare(b.name));

  return (
    <AppShell email={user.email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-paper-900">{t("stockAlert.title")}</h1>
        <p className="mt-1 text-sm text-paper-500">
          {t("stockAlert.subtitle", { n: list.length })}
        </p>
      </div>

      <StockAlertClient list={list} />
    </AppShell>
  );
}
