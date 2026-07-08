import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import ProductForm from "./product-form";
import ProductList, { type Product } from "./product-list";

export default async function AdminProductsPage() {
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

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              ← 返回首页
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-semibold text-zinc-900">商品管理后台</span>
            <span className="text-zinc-300">/</span>
            <Link
              href="/admin/orders"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              订单管理
            </Link>
            <span className="text-zinc-300">/</span>
            <Link
              href="/admin/stores"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              门店管理
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">{user.email}</span>
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

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <ProductForm />

        <div>
          <h2 className="mb-4 text-base font-semibold text-zinc-900">
            已添加商品
            {products && products.length > 0 && (
              <span className="ml-2 text-sm font-normal text-zinc-400">
                共 {products.length} 件
              </span>
            )}
          </h2>

          <ProductList products={(products ?? []) as Product[]} />
        </div>
      </main>
    </div>
  );
}
