import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { checkUser } from "@/lib/supabase/auth";
import { isLowStock } from "@/lib/stock";
import { getTransferBoard, getGroupStores } from "@/lib/transfers";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_TIME_ZONES } from "@/lib/i18n/config";
import StoreHome, { type StoreHomeOrder, type StoreHomeTransfer } from "./store-home";
import AppShell from "./app-shell";
import WarehouseRosterCard from "./transfers/warehouse-roster-card";

export default async function Home() {
  const { locale, tag, t } = await getI18n();
  const supabase = await createClient();
  const auth = await checkUser(supabase);

  // Esta pantalla no echa a nadie: si no hay sesión, enseña la portada. Por eso
  // un fallo pasajero al comprobarla no puede tratarse como «no hay sesión»,
  // porque quien estaba trabajando vería la portada de acceso y daría por hecho
  // que se le ha caído la sesión. Se corta con un error, que sí se reintenta.
  if (auth.status === "unavailable") throw new Error(t("common.authUnavailable"));
  const user = auth.user;

  const { data: profile, error: profileError } = user
    ? await supabase
        .from("profiles")
        .select("role, store_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null, error: null };

  // Mismo motivo: sin el perfil no se sabe si es almacén o tienda, y caer a la
  // portada sería enseñarle la puerta a alguien que ya está dentro.
  if (profileError) throw new Error(t("common.authUnavailable"));

  const isWarehouse = profile?.role === "warehouse";
  const isStore = profile?.role === "store";

  let pendingCount = 0;
  let productCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let storeCount = 0;
  let categoryCount = 0;
  let lowStockItems: { id: string; name: string; category: string | null; stock: number }[] = [];
  let transferRequests: Awaited<ReturnType<typeof getTransferBoard>> = [];
  let groupStores: Awaited<ReturnType<typeof getGroupStores>> = [];

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
    const lowStockAll = lowStock.map((p) => {
      const vs = variantsByProduct.get(p.id) ?? [];
      const eff = p.has_variants ? vs.reduce((s, v) => s + v.stock, 0) : p.stock;
      return {
        id: p.id,
        name: p.name as string,
        category: p.category_id ? catNameById.get(p.category_id) ?? null : null,
        stock: eff,
      };
    });
    // 「缺货」要数全部告急商品，不能数下面那张只取前 6 条的表——
    // 超过 6 个零库存时，概览上的数字会被截断成 6，比真实情况好看
    outOfStockCount = lowStockAll.filter((i) => i.stock === 0).length;
    lowStockItems = lowStockAll.sort((a, b) => a.stock - b.stock).slice(0, 6);

    [transferRequests, groupStores] = await Promise.all([
      getTransferBoard(supabase),
      getGroupStores(supabase),
    ]);
  }

  // ── 门店首页的数据：在途订单、本月单数、目录规模、别家店在求的货 ──
  let storeInProgress = 0;
  let storeMonthCount = 0;
  let storeProductCount = 0;
  let storeLastOrder: StoreHomeOrder | null = null;
  let storeTransfers: StoreHomeTransfer[] = [];
  let storeOpenTransfers = 0;

  if (isStore && user) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [inProgress, month, prods, lastOrderRes, board] = await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", user.id)
        .in("status", ["pending", "preparing"]),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("store_id", user.id)
        .gte("created_at", monthStart.toISOString()),
      supabase.from("products").select("id", { count: "exact", head: true }),
      supabase
        .from("orders")
        .select("id, status, created_at, order_items ( quantity, unit_price, products ( price ) )")
        .eq("store_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1),
      getTransferBoard(supabase),
    ]);

    storeInProgress = inProgress.count ?? 0;
    storeMonthCount = month.count ?? 0;
    storeProductCount = prods.count ?? 0;

    const raw = lastOrderRes.data?.[0];
    if (raw) {
      const items = ((raw.order_items ?? []) as unknown[]) as {
        quantity: number;
        unit_price: number | null;
        products: { price: number } | null;
      }[];
      storeLastOrder = {
        id: raw.id as string,
        status: raw.status as StoreHomeOrder["status"],
        createdAt: raw.created_at as string,
        lines: items.length,
        units: items.reduce((s, it) => s + it.quantity, 0),
        // 单价用下单时的快照，旧单没有就退回当前售价（和「我的订单」算法一致）
        total: items.reduce((s, it) => s + (it.unit_price ?? it.products?.price ?? 0) * it.quantity, 0),
      };
    }

    // 首页只展示「别人开的、我还没说没有的」求货，自己发的不算求助
    const helpable = board.filter(
      (r) => r.status === "open" && r.requesterStoreId !== user.id && !r.iDeclined
    );
    storeOpenTransfers = helpable.length;
    storeTransfers = helpable.slice(0, 3).map((r) => ({
      id: r.id,
      itemText: r.itemText,
      requesterName: r.requesterName,
      createdAt: r.createdAt,
    }));
  }

  const dateStr = new Date().toLocaleDateString(tag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: LOCALE_TIME_ZONES[locale],
  });

  // ── Warehouse 仪表盘：液态玻璃 app-shell（sidebar + 概览 + 库存告急表） ──
  if (isWarehouse) {
    return (
      <AppShell email={user?.email} displayName={profile?.store_name}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-paper-900">{t("dashboard.welcome")}</h1>
                <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-paper-400">
                  {t("dashboard.console")} · {dateStr}
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
                  <p className="text-sm font-semibold text-ember-700">{t("dashboard.pendingBanner", { n: pendingCount })}</p>
                  <p className="text-xs text-ember-600">{t("dashboard.pendingBannerCta")}</p>
                </div>
              </Link>
            )}

            {/* 门店互调：跟门店端一样的小屋看板 */}
            <WarehouseRosterCard requests={transferRequests} stores={groupStores} currentUserId={user?.id ?? ""} />

            {/* 库存概览：数字 funnel + 趋势曲线 */}
            <div className="glass-strong rounded-[22px] p-5 sm:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-paper-900">{t("dashboard.stockOverview")}</h2>
                  <p className="text-xs text-paper-400">{t("dashboard.allStoresRealtime")}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
                <Link href="/admin/products" className="group">
                  <p className="text-3xl font-semibold tracking-tight text-paper-900">{productCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">{t("dashboard.totalProducts")}</p>
                </Link>
                <Link href="/admin/stock-alert" className="group">
                  <p className={`text-3xl font-semibold tracking-tight ${lowStockCount > 0 ? "text-ember-600" : "text-paper-400"}`}>{lowStockCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">{t("dashboard.lowStockLabel")}</p>
                </Link>
                <Link href="/admin/categories" className="group">
                  <p className="text-3xl font-semibold tracking-tight text-paper-900">{categoryCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">{t("dashboard.categoriesCount")}</p>
                </Link>
                <Link href="/admin/orders" className="group">
                  <p className={`text-3xl font-semibold tracking-tight ${pendingCount > 0 ? "text-accent-600" : "text-paper-400"}`}>{pendingCount}</p>
                  <p className="mt-1 text-xs text-paper-400 group-hover:text-paper-600">{t("dashboard.pendingOrders")}</p>
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
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-paper-400"><span className="h-1.5 w-1.5 rounded-full bg-accent-500" />{t("dashboard.storeCount")}</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-mint-600">
                    {productCount > 0 ? Math.round(((productCount - lowStockCount) / productCount) * 100) : 0}%
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-paper-400"><span className="h-1.5 w-1.5 rounded-full bg-mint-500" />{t("dashboard.stockHealth")}</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-ember-600">{outOfStockCount}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-paper-400"><span className="h-1.5 w-1.5 rounded-full bg-ember-500" />{t("dashboard.outOfStock")}</p>
                </div>
              </div>
            </div>

            {/* 库存告急商品表 */}
            <div className="glass-strong rounded-[22px] p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-paper-900">{t("dashboard.lowStockTitle")}</h2>
                  <p className="text-xs text-paper-400">{t("dashboard.lowStockSubtitle", { n: lowStockCount })}</p>
                </div>
                <Link href="/admin/stock-alert" className="rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-100">
                  {t("dashboard.viewAll")}
                </Link>
              </div>

              {lowStockItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-paper-500">{t("dashboard.noLowStock")}</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-[11.5px] font-medium text-paper-400">
                        <th className="pb-2.5 pr-3">{t("dashboard.thProduct")}</th>
                        <th className="pb-2.5 pr-3">{t("dashboard.thCategory")}</th>
                        <th className="pb-2.5 pr-3">{t("dashboard.thRisk")}</th>
                        <th className="pb-2.5 pr-3 text-right tabular-nums">{t("dashboard.thRemaining")}</th>
                        <th className="pb-2.5 text-right">{t("dashboard.thStatus")}</th>
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
                              <span className="rounded-lg bg-accent-50 px-2 py-1 text-[11px] text-accent-600">{item.category ?? t("common.uncategorized")}</span>
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
                                {out ? t("dashboard.badgeOut") : t("dashboard.badgeLow")}
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

  // ── Store 首页：门店自己的小仪表盘（侧栏导航 + 在途单 + 互调） ──
  if (isStore) {
    return (
      <StoreHome
        storeName={profile?.store_name ?? null}
        email={user?.email}
        inProgressCount={storeInProgress}
        monthCount={storeMonthCount}
        productCount={storeProductCount}
        openTransfers={storeOpenTransfers}
        lastOrder={storeLastOrder}
        transfers={storeTransfers}
      />
    );
  }

  // ── 未登录：玻璃 hero ──
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="app-bg" />
      <div className="app-grain" />
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-24 text-center">
        <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.24em] text-paper-500">
          {t("landing.eyebrow")}
        </p>
        <h1 className="animate-fade-up mt-6 text-6xl font-semibold leading-[1.05] tracking-tight text-paper-900 sm:text-7xl">
          {t("landing.title")}
        </h1>
        <p className="animate-fade-up mt-6 max-w-md text-base leading-relaxed text-paper-600 [animation-delay:150ms]">
          {t("landing.subtitle")}
        </p>
        <Link
          href="/login"
          className="animate-fade-up mt-10 rounded-full bg-paper-800 px-9 py-4 text-base font-medium text-white transition-colors duration-300 [animation-delay:280ms] hover:bg-paper-700"
        >
          {t("landing.cta")}
        </Link>
      </main>
    </div>
  );
}
