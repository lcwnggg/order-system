import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import MarginClient, { type MarginProduct } from "./margin-client";

/**
 * Calculadora de ganancia: se eligen productos y cantidades y sale lo gastado,
 * lo ingresado y lo que queda.
 *
 * Página exclusiva del almacén, como el resto de /admin: el precio de compra
 * sale de `product_costs`, cuya RLS ya deja fuera a las tiendas aunque alguien
 * llegue aquí con la URL.
 */
export default async function MarginPage() {
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

  const [{ data: products }, { data: costsData }, { data: categoriesData }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price, image_url, category_id, brand, stock")
      .order("name"),
    // Si supabase/product_costs.sql no se ha ejecutado, esto falla y la lista
    // sale sin precios de compra en vez de romper la página.
    supabase.from("product_costs").select("product_id, cost_price"),
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .order("sort_order")
      .order("created_at"),
  ]);

  const costMap = new Map(
    (costsData ?? [])
      .filter((c) => c.cost_price !== null)
      .map((c) => [c.product_id as string, Number(c.cost_price)])
  );

  const list: MarginProduct[] = (products ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    price: Number(p.price),
    cost: costMap.get(p.id as string) ?? null,
    image_url: (p.image_url as string | null) ?? null,
    category_id: (p.category_id as string | null) ?? null,
    brand: (p.brand as string | null) ?? null,
    stock: Number(p.stock ?? 0),
  }));

  return (
    <AppShell email={user.email}>
      <div>
        <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">
          {t("money.eyebrow")}
        </p>
        <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">
          {t("money.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-paper-600">{t("money.subtitle")}</p>
      </div>

      <MarginClient
        products={list}
        categories={(categoriesData ?? []) as { id: string; name: string; parent_id: string | null }[]}
      />
    </AppShell>
  );
}
