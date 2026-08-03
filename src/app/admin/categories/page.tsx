import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import CategoriesClient, { type Category, type CategoryTree, type ProductSummary } from "./categories-client";
import type { ProductCost, ProductVariant } from "@/app/admin/products/actions";
import { withOptionalColumns } from "@/lib/optional-columns";

export default async function AdminCategoriesPage() {
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

  const { data: allCategories } = await supabase
    .from("categories")
    .select("id, name, parent_id, sort_order")
    .order("sort_order")
    .order("created_at");

  const [{ data: productsData }, { data: variantsData }, { data: costsData }] = await Promise.all([
    withOptionalColumns<ProductSummary[]>(["image_urls"], (img) =>
      supabase
        .from("products")
        .select(
          `id, name, category_id, price, stock, description, image_url, is_active, has_variants, brand, barcode, created_at${img}` as string
        )
        .order("name")
    ),
    supabase
      .from("product_variants")
      .select("id, product_id, color, stock, sort_order")
      .order("sort_order"),
    // Coste/proveedor: tabla con RLS de solo-almacén, y esta página ya lo es.
    supabase.from("product_costs").select("product_id, cost_price, supplier, note"),
  ]);

  const flat = (allCategories ?? []) as Category[];
  const parents = flat.filter((c) => !c.parent_id);
  const categoryTree: CategoryTree[] = parents.map((p) => ({
    ...p,
    children: flat.filter((c) => c.parent_id === p.id),
  }));

  const products = (productsData ?? []) as ProductSummary[];
  const variants = (variantsData ?? []) as ProductVariant[];
  const costs = (costsData ?? []) as ProductCost[];

  // Las etiquetas de marca/proveedor son los valores ya usados, sin tabla propia.
  const brandOptions = [...new Set(products.map((p) => p.brand).filter((b): b is string => !!b?.trim()))];
  const supplierOptions = [...new Set(costs.map((c) => c.supplier).filter((s): s is string => !!s?.trim()))];

  return (
    <AppShell email={user.email}>
        <div className="mb-6">
          <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">{t("categories.eyebrow")}</p>
          <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">{t("categories.title")}</h1>
          <p className="mt-1 text-sm text-paper-500">{t("categories.subtitle")}</p>
        </div>
        <CategoriesClient
          categoryTree={categoryTree}
          products={products}
          variants={variants}
          costs={costs}
          brandOptions={brandOptions}
          supplierOptions={supplierOptions}
        />
      </AppShell>
  );
}
