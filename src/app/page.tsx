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
  let todayCount = 0;
  let productCount = 0;
  let lowStockCount = 0;

  if (isWarehouse) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [pending, today, total, lowStock] = await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString()),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .lte("stock", 5),
    ]);

    pendingCount = pending.count ?? 0;
    todayCount = today.count ?? 0;
    productCount = total.count ?? 0;
    lowStockCount = lowStock.count ?? 0;
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

          {/* 统计卡片 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-zinc-500">待处理订单</p>
              <p className="mt-2 text-3xl font-bold text-amber-600">{pendingCount}</p>
              <p className="mt-1 text-xs text-zinc-400">笔</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-zinc-500">今日新增</p>
              <p className="mt-2 text-3xl font-bold text-blue-600">{todayCount}</p>
              <p className="mt-1 text-xs text-zinc-400">笔订单</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium text-zinc-500">商品总数</p>
              <p className="mt-2 text-3xl font-bold text-green-600">{productCount}</p>
              <p className="mt-1 text-xs text-zinc-400">件</p>
            </div>
            <Link
              href="/admin/stock-alert"
              className={`rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
                lowStockCount > 0 ? "border-red-200 hover:border-red-300" : "border-zinc-200"
              }`}
            >
              <p className="text-xs font-medium text-zinc-500">库存告急</p>
              <p className={`mt-2 text-3xl font-bold ${lowStockCount > 0 ? "text-red-600" : "text-zinc-400"}`}>
                {lowStockCount}
              </p>
              <p className="mt-1 text-xs text-zinc-400">库存 ≤ 5 件 → 点击查看</p>
            </Link>
          </div>

          {/* 功能入口 */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Link
              href="/admin/products"
              className="group flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 transition-colors group-hover:bg-zinc-900">
                <svg className="h-6 w-6 text-zinc-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">商品管理</h2>
                <p className="mt-1 text-xs text-zinc-500">添加商品、修改价格与库存</p>
              </div>
            </Link>

            <Link
              href="/admin/orders"
              className="group flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 transition-colors group-hover:bg-zinc-900">
                <svg className="h-6 w-6 text-zinc-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">
                  订单管理
                  {pendingCount > 0 && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700">
                      {pendingCount}
                    </span>
                  )}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">查看订单、推进备货状态</p>
              </div>
            </Link>

            <Link
              href="/admin/stores"
              className="group flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 transition-colors group-hover:bg-zinc-900">
                <svg className="h-6 w-6 text-zinc-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">门店管理</h2>
                <p className="mt-1 text-xs text-zinc-500">为分店设置名称与信息</p>
              </div>
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
