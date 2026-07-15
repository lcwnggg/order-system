import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { isLowStock } from "@/lib/stock";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("role, store_name")
        .eq("id", user.id)
        .single()
    : { data: null };

  const isWarehouse = profile?.role === "warehouse";
  const isStore = profile?.role === "store";

  let pendingCount = 0;
  let productCount = 0;
  let lowStockCount = 0;
  let storeCount = 0;
  let categoryCount = 0;

  if (isWarehouse) {
    const [pending, total, stores, cats, prodStock, varStock] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "store"),
      supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
      // 库存告急需按变体口径统计：拉全部商品的 has_variants/stock 与所有变体库存，在内存中判断
      supabase.from("products").select("id, has_variants, stock"),
      supabase.from("product_variants").select("product_id, stock"),
    ]);
    pendingCount = pending.count ?? 0;
    productCount = total.count ?? 0;
    storeCount = stores.count ?? 0;
    categoryCount = cats.count ?? 0;

    const variantsByProduct = new Map<string, { stock: number }[]>();
    for (const v of varStock.data ?? []) {
      const arr = variantsByProduct.get(v.product_id) ?? [];
      arr.push({ stock: v.stock });
      variantsByProduct.set(v.product_id, arr);
    }
    lowStockCount = (prodStock.data ?? []).filter((p) =>
      isLowStock(p, variantsByProduct.get(p.id) ?? [])
    ).length;
  }

  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  });

  return (
    <div className="min-h-screen bg-paper-100">
      {/* ── Header ── */}
      <header className="border-b border-paper-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-sm font-semibold text-paper-900">我的小店</span>
          <div className="flex items-center gap-2 sm:gap-3">
            {isWarehouse && (
              <div className="hidden items-center gap-2 sm:flex">
                <Link
                  href="/admin/products"
                  className="rounded-lg bg-paper-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-paper-800"
                >
                  商品管理
                </Link>
                <Link
                  href="/admin/orders"
                  className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
                >
                  订单管理
                </Link>
                <Link
                  href="/admin/stores"
                  className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
                >
                  门店管理
                </Link>
                <Link
                  href="/admin/categories"
                  className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
                >
                  分类管理
                </Link>
              </div>
            )}
            {isStore && (
              <Link
                href="/shop"
                className="rounded-lg bg-paper-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-paper-800"
              >
                门店下单
              </Link>
            )}
            {user ? (
              <>
                <span className="hidden text-sm text-paper-500 sm:block">{user.email}</span>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="rounded-lg border border-paper-200 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-paper-100"
                  >
                    退出登录
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-paper-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-paper-800"
              >
                登录
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Warehouse 仪表盘 ── */}
      {isWarehouse && (
        <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
          {/* 欢迎 */}
          <div>
            <h1 className="text-2xl font-semibold text-paper-900">欢迎回来！</h1>
            <p className="mt-1 text-sm text-paper-500">{dateStr}</p>
          </div>

          {/* 待备货提醒 */}
          {pendingCount > 0 && (
            <Link
              href="/admin/orders"
              className="flex items-center gap-4 rounded-xl border border-ember-200 bg-ember-50 px-5 py-4 transition-colors hover:bg-ember-100"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-ember-50">
                <svg className="h-5 w-5 text-ember-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ember-800">
                  你有 {pendingCount} 笔订单待备货
                </p>
                <p className="text-xs text-ember-600">点击进入订单管理 →</p>
              </div>
            </Link>
          )}

          {/* 5 个可点击数字卡 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Link
              href="/admin/orders"
              className={`group rounded-2xl border bg-paper-25 p-5 transition duration-200 ${
                pendingCount > 0 ? "border-ember-200" : "border-paper-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${pendingCount > 0 ? "bg-ember-50 text-ember-600" : "bg-paper-100 text-paper-500"}`}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                </span>
                <span className="text-paper-300 transition group-hover:translate-x-0.5 group-hover:text-paper-500">→</span>
              </div>
              <p className={`mt-3 text-3xl font-normal tracking-tight ${pendingCount > 0 ? "text-ember-600" : "text-paper-400"}`}>{pendingCount}</p>
              <p className="mt-0.5 text-xs font-medium text-paper-500">待处理订单</p>
            </Link>

            <Link
              href="/admin/products"
              className="group rounded-2xl border border-paper-200 bg-paper-25 p-5 transition duration-200"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-100 text-paper-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                </span>
                <span className="text-paper-300 transition group-hover:translate-x-0.5 group-hover:text-paper-500">→</span>
              </div>
              <p className="mt-3 text-3xl font-normal tracking-tight text-paper-900">{productCount}</p>
              <p className="mt-0.5 text-xs font-medium text-paper-500">商品总数</p>
            </Link>

            <Link
              href="/admin/stock-alert"
              className={`group rounded-2xl border bg-paper-25 p-5 transition duration-200 ${
                lowStockCount > 0 ? "border-ember-200" : "border-paper-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${lowStockCount > 0 ? "bg-ember-50 text-ember-600" : "bg-paper-100 text-paper-500"}`}>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                </span>
                <span className="text-paper-300 transition group-hover:translate-x-0.5 group-hover:text-paper-500">→</span>
              </div>
              <p className={`mt-3 text-3xl font-normal tracking-tight ${lowStockCount > 0 ? "text-ember-600" : "text-paper-400"}`}>{lowStockCount}</p>
              <p className="mt-0.5 text-xs font-medium text-paper-500">库存告急 <span className="text-paper-400">≤ 5</span></p>
            </Link>

            <Link
              href="/admin/stores"
              className="group rounded-2xl border border-paper-200 bg-paper-25 p-5 transition duration-200"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-100 text-paper-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-4m-6 0H3m2 0h4M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                </span>
                <span className="text-paper-300 transition group-hover:translate-x-0.5 group-hover:text-paper-500">→</span>
              </div>
              <p className="mt-3 text-3xl font-normal tracking-tight text-paper-900">{storeCount}</p>
              <p className="mt-0.5 text-xs font-medium text-paper-500">门店数</p>
            </Link>

            <Link
              href="/admin/categories"
              className="group rounded-2xl border border-paper-200 bg-paper-25 p-5 transition duration-200"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-paper-100 text-paper-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5a1.99 1.99 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.99 1.99 0 013 12V7a4 4 0 014-4z" /></svg>
                </span>
                <span className="text-paper-300 transition group-hover:translate-x-0.5 group-hover:text-paper-500">→</span>
              </div>
              <p className="mt-3 text-3xl font-normal tracking-tight text-paper-900">{categoryCount}</p>
              <p className="mt-0.5 text-xs font-medium text-paper-500">商品大类</p>
            </Link>
          </div>
        </main>
      )}

      {/* ── Store 首页 ── */}
      {isStore && (
        <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
          <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-paper-700">
            <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-paper-900">
            {profile?.store_name ? `你好，${profile.store_name}！` : "你好！"}
          </h1>
          <p className="mt-2 text-sm text-paper-500">准备好下单了吗？浏览商品，加入购物车，一键提交。</p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/shop"
              className="rounded-xl bg-paper-700 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-paper-800"
            >
              进入商城下单 →
            </Link>
            <Link
              href="/shop/orders"
              className="rounded-xl border border-paper-200 bg-paper-25 px-6 py-4 text-base font-medium text-paper-700 transition-colors hover:bg-paper-100"
            >
              我的订单
            </Link>
          </div>
        </main>
      )}

      {/* ── 未登录 ── */}
      {!user && (
        <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
          <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-paper-700">
            <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-paper-900">欢迎使用我的小店</h1>
          <p className="mt-2 text-sm text-paper-500">供应商与分店的订货管理平台。请登录以继续。</p>
          <Link
            href="/login"
            className="mt-8 rounded-xl bg-paper-700 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-paper-800"
          >
            立即登录
          </Link>
        </main>
      )}
    </div>
  );
}
