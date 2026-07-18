import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isLowStock } from "@/lib/stock";
import StoreHero from "./store-hero";
import AppShell from "./app-shell";

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
  let lowStockItems: { id: string; name: string; category: string | null; stock: number }[] = [];

  if (isWarehouse) {
    const [pending, total, stores, cats, prodStock, varStock, catNames] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "store"),
      supabase.from("categories").select("id", { count: "exact", head: true }).is("parent_id", null),
      // 库存告急需按变体口径统计：拉全部商品的 has_variants/stock/名称/分类 与所有变体库存，在内存中判断
      supabase.from("products").select("id, name, category_id, has_variants, stock"),
      supabase.from("product_variants").select("product_id, stock"),
      supabase.from("categories").select("id, name"),
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
    const catNameById = new Map<string, string>();
    for (const c of catNames.data ?? []) catNameById.set(c.id, c.name);

    const lowStock = (prodStock.data ?? []).filter((p) =>
      isLowStock(p, variantsByProduct.get(p.id) ?? [])
    );
    lowStockCount = lowStock.length;
    lowStockItems = lowStock
      .map((p) => {
        const vs = variantsByProduct.get(p.id) ?? [];
        const eff = p.has_variants ? vs.reduce((s, v) => s + v.stock, 0) : p.stock;
        return {
          id: p.id,
          name: p.name as string,
          category: p.category_id ? catNameById.get(p.category_id) ?? null : null,
          stock: eff,
        };
      })
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 6);
  }

  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Shanghai",
  });

  // ── Warehouse 仪表盘：液态玻璃 app-shell（sidebar + 概览 + 库存告急表） ──
  if (isWarehouse) {
    return (
      <AppShell email={user?.email} displayName={profile?.store_name}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-paper-900">欢迎回来</h1>
                <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-paper-400">
                  仓库控制台 · {dateStr}
                </p>
              </div>
            </div>

            {/* 待备货提醒 */}
            {pendingCount > 0 && (
              <Link
                href="/admin/orders"
                className="glass-strong flex items-center gap-4 rounded-2xl px-5 py-4 transition-transform hover:-translate-y-0.5"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-ember-50 text-ember-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ember-700">你有 {pendingCount} 笔订单待备货</p>
                  <p className="text-xs text-ember-600">点击进入订单管理 →</p>
                </div>
              </Link>
            )}

            {/* 库存概览：数字 funnel + 趋势曲线 */}
            <div className="glass-strong rounded-[22px] p-5 sm:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-paper-900">库存概览</h2>
                  <p className="text-xs text-paper-400">全部门店 · 实时</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                <Link href="/admin/products" className="group">
                  <p className="text-3xl font-semibold tracking-tight text-paper-900">{productCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">商品总数</p>
                </Link>
                <Link href="/admin/stock-alert" className="group">
                  <p className={`text-3xl font-semibold tracking-tight ${lowStockCount > 0 ? "text-ember-600" : "text-paper-400"}`}>{lowStockCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">库存告急 ≤5</p>
                </Link>
                <Link href="/admin/categories" className="group">
                  <p className="text-3xl font-semibold tracking-tight text-paper-900">{categoryCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">商品大类</p>
                </Link>
                <Link href="/admin/orders" className="group">
                  <p className={`text-3xl font-semibold tracking-tight ${pendingCount > 0 ? "text-accent-600" : "text-paper-400"}`}>{pendingCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">待处理订单</p>
                </Link>
              </div>
              {/* 趋势曲线（示意） */}
              <div className="mt-5">
                <svg viewBox="0 0 520 120" className="h-[120px] w-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#5b6fd6" stopOpacity="0.4" />
                      <stop offset="1" stopColor="#5b6fd6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0,82 C70,56 120,90 190,70 C260,48 320,96 390,66 C450,42 490,54 520,48 L520,120 L0,120 Z" fill="url(#trend)" />
                  <path d="M0,82 C70,56 120,90 190,70 C260,48 320,96 390,66 C450,42 490,54 520,48" fill="none" stroke="#5b6fd6" strokeWidth="2.5" />
                  <circle cx="520" cy="48" r="4" fill="#5b6fd6" stroke="#fff" strokeWidth="2" />
                </svg>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3 border-t border-paper-900/10 pt-4">
                <div>
                  <p className="text-lg font-semibold text-paper-900">{storeCount}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-paper-400"><span className="h-1.5 w-1.5 rounded-full bg-accent-500" />门店数</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-mint-600">
                    {productCount > 0 ? Math.round(((productCount - lowStockCount) / productCount) * 100) : 0}%
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-paper-400"><span className="h-1.5 w-1.5 rounded-full bg-mint-500" />库存健康</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-ember-600">{lowStockItems.filter((i) => i.stock === 0).length}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-paper-400"><span className="h-1.5 w-1.5 rounded-full bg-ember-500" />已断货</p>
                </div>
              </div>
            </div>

            {/* 库存告急商品表 */}
            <div className="glass-strong rounded-[22px] p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-paper-900">库存告急商品</h2>
                  <p className="text-xs text-paper-400">按变体口径 · {lowStockCount} 项需处理</p>
                </div>
                <Link href="/admin/stock-alert" className="rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-100">
                  查看全部
                </Link>
              </div>

              {lowStockItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-paper-500">🎉 暂无库存告急商品</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-[11.5px] font-medium text-paper-400">
                        <th className="pb-2.5 pr-3">商品</th>
                        <th className="pb-2.5 pr-3">分类</th>
                        <th className="pb-2.5 pr-3">库存风险</th>
                        <th className="pb-2.5 pr-3 text-right tabular-nums">剩余</th>
                        <th className="pb-2.5 text-right">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockItems.map((item) => {
                        const out = item.stock === 0;
                        const bars = out ? 4 : item.stock <= 2 ? 4 : item.stock <= 3 ? 3 : 2;
                        return (
                          <tr key={item.id} className="border-t border-paper-900/10">
                            <td className="py-2.5 pr-3">
                              <div className="flex items-center gap-3">
                                <span className="h-7 w-7 shrink-0 rounded-[9px] bg-gradient-to-br from-accent-200 to-[#d8c4e8]" />
                                <span className="font-medium text-paper-900">{item.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className="rounded-lg bg-accent-50 px-2 py-1 text-[11px] text-accent-600">{item.category ?? "未分类"}</span>
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className="inline-flex gap-[3px]">
                                {[0, 1, 2, 3].map((i) => (
                                  <span key={i} className={`h-[15px] w-[5px] rounded-sm ${i < bars ? "bg-ember-500" : "bg-paper-900/15"}`} />
                                ))}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-paper-900">{item.stock}</td>
                            <td className="py-2.5 text-right">
                              <span className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium ${out ? "bg-ember-50 text-ember-600" : "bg-[#f7efe0] text-[#b07d2c]"}`}>
                                {out ? "断货" : "告急"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
      </AppShell>
    );
  }

  // ── Store 首页：编辑风 hero ──
  if (isStore) {
    return (
      <div className="relative flex min-h-screen flex-col">
        <div className="app-bg" />
        <div className="app-grain" />
        <StoreHero storeName={profile?.store_name ?? null} />
      </div>
    );
  }

  // ── 未登录：玻璃 hero ──
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="app-bg" />
      <div className="app-grain" />
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.24em] text-paper-500">
          供应商 × 分店 — 订货平台
        </p>
        <h1 className="animate-fade-up mt-6 text-6xl font-semibold leading-[1.05] tracking-tight text-paper-900 sm:text-7xl">
          我的小店。
        </h1>
        <p className="animate-fade-up mt-6 max-w-md text-base leading-relaxed text-paper-600 [animation-delay:150ms]">
          连接仓库与门店的订货管理平台。请登录以继续。
        </p>
        <Link
          href="/login"
          className="animate-fade-up mt-10 rounded-full bg-paper-800 px-9 py-4 text-base font-medium text-white transition-colors duration-300 [animation-delay:280ms] hover:bg-paper-700"
        >
          立即登录
        </Link>
      </main>
    </div>
  );
}
