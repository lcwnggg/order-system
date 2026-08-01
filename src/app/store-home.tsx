import Link from "next/link";
import AppShell from "./app-shell";
import TransferNavBadge from "./transfer-nav-badge";
import { getI18n } from "@/lib/i18n/server";
import { LOCALE_TIME_ZONES } from "@/lib/i18n/config";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

export type StoreHomeOrder = {
  id: string;
  status: "pending" | "preparing" | "done" | "cancelled";
  createdAt: string;
  lines: number;
  units: number;
  total: number;
};

export type StoreHomeTransfer = {
  id: string;
  itemText: string;
  requesterName: string | null;
  createdAt: string;
};

const STATUS_KEY: Record<StoreHomeOrder["status"], TranslationKey> = {
  pending: "orderStatus.pending",
  preparing: "orderStatus.preparing",
  done: "orderStatus.done",
  cancelled: "orderStatus.cancelled",
};

const STATUS_COLOR: Record<StoreHomeOrder["status"], string> = {
  pending: "bg-ember-50 text-ember-700",
  preparing: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  cancelled: "bg-paper-100 text-paper-500",
};

/**
 * 门店首页。以前只有一句「你好」加两个按钮，等于把人放在门口不告诉他里面有什么；
 * 现在直接把门店真正关心的三件事摆在首页：在途订单、上一单、别人求货的互调。
 */
export default async function StoreHome({
  storeName,
  email,
  inProgressCount,
  monthCount,
  productCount,
  openTransfers,
  lastOrder,
  transfers,
}: {
  storeName: string | null;
  email?: string | null;
  inProgressCount: number;
  monthCount: number;
  productCount: number;
  openTransfers: number;
  lastOrder: StoreHomeOrder | null;
  transfers: StoreHomeTransfer[];
}) {
  const { locale, tag, t } = await getI18n();
  const tz = LOCALE_TIME_ZONES[locale];

  const dateStr = new Date().toLocaleDateString(tag, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: tz,
  });
  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(tag, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    });

  const stats: { href: string; labelKey: TranslationKey; value: number; accent?: boolean }[] = [
    { href: "/shop/orders", labelKey: "storeHome.statInProgress", value: inProgressCount, accent: inProgressCount > 0 },
    { href: "/shop/orders", labelKey: "storeHome.statThisMonth", value: monthCount },
    { href: "/shop", labelKey: "storeHome.statCatalog", value: productCount },
    { href: "/transfers", labelKey: "storeHome.statTransfers", value: openTransfers, accent: openTransfers > 0 },
  ];

  return (
    <AppShell variant="store" email={email} displayName={storeName}>
      {/* ── 招呼 + 主行动 ── */}
      <div className="glass-strong relative overflow-hidden rounded-[26px] px-6 py-7 sm:px-8">
        {/* .iri-ball 自带 position:relative，直接加 absolute 会被它盖掉而占住文档流，
            所以定位交给外面这层壳 */}
        <div className="pointer-events-none absolute -right-12 -top-12 hidden h-44 w-44 opacity-60 sm:block" aria-hidden>
          <div className="iri-ball h-full w-full blur-[1px]" />
        </div>
        <div className="relative z-10">
          <p className="animate-fade-in font-mono text-[10.5px] uppercase tracking-[0.2em] text-paper-500">
            {t("storeHero.eyebrow")}
            {/* 手机上完整日期会把这行撑成三行，只在宽屏显示 */}
            <span className="hidden sm:inline"> · {dateStr}</span>
          </p>
          <h1 className="animate-fade-up mt-3 text-3xl font-semibold tracking-tight text-paper-900 sm:text-4xl">
            {storeName ? t("storeHero.greetingNamed", { name: storeName }) : t("storeHero.greeting")}
          </h1>
          <p className="animate-fade-up mt-2 max-w-lg text-sm leading-relaxed text-paper-600 [animation-delay:120ms]">
            {inProgressCount > 0
              ? t("storeHome.subtitleInProgress", { n: inProgressCount })
              : t("storeHome.subtitleIdle")}
          </p>
          <div className="animate-fade-up mt-6 flex flex-wrap gap-3 [animation-delay:220ms]">
            <Link
              href="/shop"
              className="rounded-full bg-paper-800 px-7 py-3.5 text-[15px] font-medium text-white shadow-[0_16px_30px_-14px_rgba(27,32,48,.7)] transition-colors duration-300 hover:bg-paper-700"
            >
              {t("storeHero.enterShop")}
            </Link>
            <Link
              href="/transfers"
              className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/50 px-6 py-3.5 text-[15px] font-medium text-paper-700 transition-colors duration-300 hover:bg-white/80"
            >
              {t("storeHome.askOtherStores")}
              <TransferNavBadge />
            </Link>
          </div>
        </div>
      </div>

      {/* ── 四个数字 ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.labelKey}
            href={s.href}
            className="glass rounded-2xl px-4 py-4 transition-transform hover:-translate-y-0.5"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-400">{t(s.labelKey)}</p>
            <p
              className={`mt-1.5 text-2xl font-semibold tabular-nums ${
                s.accent ? "text-accent-600" : "text-paper-900"
              }`}
            >
              {s.value}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 上一单 ── */}
        <div className="glass rounded-2xl px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-paper-900">{t("storeHome.lastOrderTitle")}</h2>
            <Link
              href="/shop/orders"
              className="rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-100"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>

          {lastOrder ? (
            <Link href="/shop/orders" className="mt-4 block rounded-xl bg-white/45 px-4 py-4 transition-colors hover:bg-white/70">
              <div className="flex items-center justify-between gap-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[lastOrder.status]}`}>
                  {t(STATUS_KEY[lastOrder.status])}
                </span>
                <span className="text-xs text-paper-400">{shortDate(lastOrder.createdAt)}</span>
              </div>
              <p className="mt-3 text-sm text-paper-600">
                {t("storeHome.lastOrderLines", { lines: lastOrder.lines, units: lastOrder.units })}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-paper-900">
                €{lastOrder.total.toFixed(2)}
              </p>
            </Link>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-paper-500">{t("storeHome.noOrders")}</p>
              <Link
                href="/shop"
                className="mt-3 inline-block rounded-full bg-paper-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-paper-700"
              >
                {t("storeHome.firstOrderCta")}
              </Link>
            </div>
          )}
        </div>

        {/* ── 别的店在求货 ── */}
        <div className="glass rounded-2xl px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-paper-900">{t("storeHome.transfersTitle")}</h2>
              <p className="text-xs text-paper-400">{t("storeHome.transfersSubtitle")}</p>
            </div>
            <Link
              href="/transfers"
              className="rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-100"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>

          {transfers.length === 0 ? (
            <p className="py-10 text-center text-sm text-paper-500">{t("storeHome.noTransfers")}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {transfers.map((r) => (
                <li key={r.id}>
                  <Link
                    href="/transfers"
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/45 px-4 py-3 transition-colors hover:bg-white/70"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-paper-900">{r.itemText}</span>
                      <span className="block truncate text-xs text-paper-500">
                        {r.requesterName ?? t("role.store")} · {shortDate(r.createdAt)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-accent-50 px-2.5 py-1 text-[11.5px] font-medium text-accent-600">
                      {t("storeHome.transfersHelp")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
