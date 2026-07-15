import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
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
    <div className="min-h-screen bg-sage-100">
      <header className="border-b border-sage-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link href="/" className="text-sm text-sage-500 transition-colors hover:text-sage-900">
              ← 首页
            </Link>
            <span className="text-sage-400">/</span>
            <Link href="/admin/products" className="text-sm text-sage-500 transition-colors hover:text-sage-900">
              商品管理
            </Link>
            <span className="text-sage-400">/</span>
            <span className="text-sm font-semibold text-sage-900">批量导入</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-sage-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-sage-200 px-3 py-1.5 text-sm text-sage-700 transition-colors hover:bg-sage-100"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-sage-900">批量导入商品</h1>
          <p className="mt-1 text-sm text-sage-500">
            从 CSV / Excel 文件批量导入商品，导入前可在页面上逐格核对与修改。
          </p>
        </div>

        <ImportClient
          categories={categoriesData ?? []}
          existingProducts={productsData ?? []}
        />
      </main>
    </div>
  );
}
