import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

export default async function StockAlertPage() {
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
    .select("id, name, stock, image_url, is_active")
    .lte("stock", 5)
    .order("stock", { ascending: true })
    .order("name");

  const list = products ?? [];

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link href="/" className="text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              ← 首页
            </Link>
            <span className="text-zinc-300">/</span>
            <Link href="/admin/products" className="text-sm text-zinc-500 transition-colors hover:text-zinc-900">
              商品管理
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-semibold text-zinc-900">库存告急</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:block">{user.email}</span>
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

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">库存告急商品</h1>
          <p className="mt-1 text-sm text-zinc-400">
            以下商品库存 ≤ 5 件，共 {list.length} 件，请及时补货。
          </p>
        </div>

        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-20 text-center">
            <p className="text-sm text-zinc-400">暂无库存告急商品</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 text-left">
                  <th className="px-5 py-3 font-medium text-zinc-500">商品名称</th>
                  <th className="px-5 py-3 font-medium text-zinc-500">状态</th>
                  <th className="px-5 py-3 text-right font-medium text-zinc-500">当前库存</th>
                  <th className="px-5 py-3 font-medium text-zinc-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {list.map((product) => (
                  <tr key={product.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {product.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="h-10 w-10 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-zinc-100" />
                        )}
                        <span className="font-medium text-zinc-900">{product.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          product.is_active
                            ? "bg-green-50 text-green-700"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {product.is_active ? "上架" : "下架"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={`text-lg font-bold ${
                          product.stock === 0 ? "text-red-600" : "text-amber-600"
                        }`}
                      >
                        {product.stock}
                      </span>
                      <span className="ml-1 text-xs text-zinc-400">件</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href="/admin/products"
                        className="text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                      >
                        去补货 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
