import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import AdminNav from "@/app/admin/admin-nav";
import { getTotalStock, isLowStock } from "@/lib/stock";

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
    <div className="relative min-h-screen">
      <div className="app-bg" />
      <div className="app-grain" />
      <header className="glass sticky top-0 z-30 px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <AdminNav />
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-paper-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-white/50 bg-white/40 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-white/70"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-paper-900">库存告急商品</h1>
          <p className="mt-1 text-sm text-paper-500">
            以下商品库存 ≤ 5 件，共 {list.length} 件，请及时补货。
          </p>
        </div>

        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-paper-300 bg-white py-20 text-center">
            <p className="text-sm text-paper-500">暂无库存告急商品</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl glass-strong">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-paper-100 bg-paper-100 text-left">
                  <th className="px-5 py-3 font-medium text-paper-500">商品名称</th>
                  <th className="px-5 py-3 font-medium text-paper-500">状态</th>
                  <th className="px-5 py-3 text-right font-medium text-paper-500">当前库存</th>
                  <th className="px-5 py-3 font-medium text-paper-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-100">
                {list.map((product) => (
                  <tr key={product.id} className="hover:bg-paper-100">
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
                          <div className="h-10 w-10 rounded-lg bg-paper-100" />
                        )}
                        <span className="font-medium text-paper-900">{product.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          product.is_active
                            ? "bg-green-50 text-green-700"
                            : "bg-paper-100 text-paper-500"
                        }`}
                      >
                        {product.is_active ? "上架" : "下架"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {product.has_variants ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {product.variants.length === 0 ? (
                            <span className="text-xs text-paper-500">暂无变体</span>
                          ) : (
                            product.variants.map((v) => (
                              <span
                                key={v.id}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                  v.stock === 0
                                    ? "bg-red-50 text-red-600"
                                    : v.stock <= 5
                                    ? "bg-amber-50 text-amber-600"
                                    : "bg-green-50 text-green-600"
                                }`}
                              >
                                <span className="text-paper-500">{v.color}</span>
                                {v.stock === 0 ? "售罄" : v.stock}
                              </span>
                            ))
                          )}
                        </div>
                      ) : (
                        <>
                          <span
                            className={`text-lg font-bold ${
                              product.stock === 0 ? "text-red-600" : "text-amber-600"
                            }`}
                          >
                            {product.stock}
                          </span>
                          <span className="ml-1 text-xs text-paper-500">件</span>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href="/admin/products"
                        className="text-xs font-medium text-paper-500 hover:text-paper-900 hover:underline"
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
