import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

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
    const [pending, total, lowStock, stores, cats] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("products").select("id", { count: "exact", head: true }).lte("stock", 5),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "store"),
      supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
    ]);
    pendingCount = pending.count ?? 0;
    productCount = total.count ?? 0;
    lowStockCount = lowStock.count ?? 0;
    storeCount = stores.count ?? 0;
    categoryCount = cats.count ?? 0;
  }

  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  });

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* ── Header ── */}
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-sm font-semibold text-zinc-900">我的小店</span>
          <div className="flex items-center gap-3">
            {isWarehouse && (
              <>
                <Link
                  href="/admin/products"
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
                >
                  商品管理
                </Link>
                <Link
                  href="/admin/orders"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  订单管理
                </Link>
                <Link
                  href="/admin/stores"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  门店管理
                </Link>
                <Link
                  href="/admin/categories"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
                >
                  分类管理
                </Link>
              </>
            )}
            {isStore && (
              <Link
                href="/shop"
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
              >
                门店下单
              </Link>
            )}
            {user ? (
              <>
                <span className="hidden text-sm text-zinc-500 sm:block">{user.email}</span>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    退出登录
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
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
            <h1 className="text-2xl font-semibold text-zinc-900">欢迎回来！</h1>
            <p className="mt-1 text-sm text-zinc-500">{dateStr}</p>
          </div>

          {/* 待备货提醒 */}
          {pendingCount > 0 && (
            <Link
              href="/admin/orders"
              className="flex items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 transition-colors hover:bg-amber-100"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  你有 {pendingCount} 笔订单待备货
                </p>
                <p className="text-xs text-amber-600">点击进入订单管理 →</p>
              </div>
            </Link>
          )}

          {/* 5 个可点击数字卡 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Link
              href="/admin/orders"
              className={`rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${
                pendingCount > 0 ? "border-amber-200 hover:border-amber-400" : "border-zinc-200 hover:border-zinc-300"
              }`}
            >
              <p className="text-xs font-medium text-zinc-500">待处理订单</p>
              <p className={`mt-2 text-3xl font-bold ${pendingCount > 0 ? "text-amber-600" : "text-zinc-400"}`}>
                {pendingCount}
              </p>
              <p className="mt-1 text-xs text-zinc-400">笔 →</p>
            </Link>

            <Link
              href="/admin/products"
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-green-300 hover:shadow-md"
            >
              <p className="text-xs font-medium text-zinc-500">商品总数</p>
              <p className="mt-2 text-3xl font-bold text-green-600">{productCount}</p>
              <p className="mt-1 text-xs text-zinc-400">件 →</p>
            </Link>

            <Link
              href="/admin/stock-alert"
              className={`rounded-xl border bg-white p-5 shadow-sm transition-all hover:shadow-md ${
                lowStockCount > 0 ? "border-red-200 hover:border-red-400" : "border-zinc-200 hover:border-zinc-300"
              }`}
            >
              <p className="text-xs font-medium text-zinc-500">库存告急</p>
              <p className={`mt-2 text-3xl font-bold ${lowStockCount > 0 ? "text-red-600" : "text-zinc-400"}`}>
                {lowStockCount}
              </p>
              <p className="mt-1 text-xs text-zinc-400">≤ 5 件 →</p>
            </Link>

            <Link
              href="/admin/stores"
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
            >
              <p className="text-xs font-medium text-zinc-500">门店数</p>
              <p className="mt-2 text-3xl font-bold text-blue-600">{storeCount}</p>
              <p className="mt-1 text-xs text-zinc-400">家 →</p>
            </Link>

            <Link
              href="/admin/categories"
              className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-purple-300 hover:shadow-md"
            >
              <p className="text-xs font-medium text-zinc-500">商品大类</p>
              <p className="mt-2 text-3xl font-bold text-purple-600">{categoryCount}</p>
              <p className="mt-1 text-xs text-zinc-400">个 →</p>
            </Link>
          </div>
        </main>
      )}

      {/* ── Store 首页 ── */}
      {isStore && (
        <main className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
          <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-900">
            <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            {profile?.store_name ? `你好，${profile.store_name}！` : "你好！"}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">准备好下单了吗？浏览商品，加入购物车，一键提交。</p>
          <Link
            href="/shop"
            className="mt-8 rounded-xl bg-zinc-900 px-8 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700"
          >
            进入商城下单 →
          </Link>
        </main>
      )}

      {/* ── 未登录 ── */}
      {!user && (
        <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
          <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-zinc-900">
            <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900">欢迎使用我的小店</h1>
          <p className="mt-2 text-sm text-zinc-500">供应商与分店的订货管理平台。请登录以继续。</p>
          <Link
            href="/login"
            className="mt-8 rounded-xl bg-zinc-900 px-8 py-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700"
          >
            立即登录
          </Link>
        </main>
      )}
    </div>
  );
}
