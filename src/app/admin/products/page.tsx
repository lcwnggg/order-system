import Link from "next/link";
import { denyPage, requireRole } from "@/lib/supabase/guard";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import AddProductPanel from "./add-product-panel";
import ProductList, { type Product } from "./product-list";
import type { Category } from "@/app/admin/categories/categories-client";
import type { ProductCost, ProductVariant } from "./actions";

export default async function AdminProductsPage() {
  const { t } = await getI18n();
  const guard = await requireRole("warehouse");
  if ("error" in guard) denyPage(guard, t);
  const { supabase, user } = guard;

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

  // Coste y proveedor: tabla aparte, con RLS de solo-almacén. Esta página ya es
  // exclusiva del almacén, así que aquí sí se leen y se pintan.
  const { data: costsData } = await supabase
    .from("product_costs")
    .select("product_id, cost_price, supplier, note");

  const categories = (categoriesData ?? []) as Category[];
  const productVariants = (productVariantsData ?? []) as ProductVariant[];
  const productList = (products ?? []) as Product[];
  const costs = (costsData ?? []) as ProductCost[];

  // Las etiquetas de marca y proveedor no tienen tabla propia: son simplemente
  // los valores que ya se han usado. Así la lista se mantiene sola.
  const brandOptions = [...new Set(productList.map((p) => p.brand).filter((b): b is string => !!b?.trim()))];
  const supplierOptions = [...new Set(costs.map((c) => c.supplier).filter((s): s is string => !!s?.trim()))];

  return (
    <AppShell email={user.email}>
      <div className="space-y-8">
        <AddProductPanel
          categories={categories}
          products={productList}
          brandOptions={brandOptions}
          supplierOptions={supplierOptions}
        />

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-paper-900">
              {t("adminProducts.added")}
              {productList.length > 0 && (
                <span className="ml-2 text-sm font-normal text-paper-500">
                  {t("adminProducts.countTotal", { n: productList.length })}
                </span>
              )}
            </h2>
            <Link
              href="/admin/products/import"
              className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
            >
              {t("adminProducts.bulkImport")}
            </Link>
          </div>

          <ProductList
            products={productList}
            categories={categories}
            variants={productVariants}
            costs={costs}
            brandOptions={brandOptions}
            supplierOptions={supplierOptions}
          />
        </div>
      </div>
    </AppShell>
  );
}
