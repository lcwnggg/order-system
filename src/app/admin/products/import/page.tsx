import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import ImportClient from "./import-client";

export default async function BulkImportPage() {
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

  const [{ data: categoriesData }, { data: productsData }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("products")
      .select("id, name, price, stock, brand, category_id, has_variants")
      .order("name"),
  ]);

  return (
    <AppShell email={user.email}>
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-paper-900">批量导入商品</h1>
          <p className="mt-1 text-sm text-paper-500">
            从 CSV / Excel 文件批量导入商品，导入前可在页面上逐格核对与修改。
          </p>
        </div>

        <ImportClient
          categories={categoriesData ?? []}
          existingProducts={productsData ?? []}
        />
      </AppShell>
  );
}
