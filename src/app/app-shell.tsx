"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions/auth";

type NavItem = { href: string; label: string; d: string };

const ADMIN_NAV: NavItem[] = [
  { href: "/", label: "仪表盘", d: "M4 6h16M4 12h16M4 18h7" },
  { href: "/admin/products", label: "商品管理", d: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" },
  { href: "/admin/orders", label: "订单管理", d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { href: "/admin/stores", label: "门店管理", d: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m4-14h1m-1 4h1m4-4h1m-1 4h1" },
  { href: "/admin/categories", label: "分类管理", d: "M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" },
  { href: "/admin/products/import", label: "批量导入", d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" },
];

const STORE_NAV: NavItem[] = [
  { href: "/", label: "首页", d: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/shop", label: "门店下单", d: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" },
  { href: "/shop/orders", label: "我的订单", d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
];

export default function AppShell({
  variant = "admin",
  email,
  displayName,
  children,
}: {
  variant?: "admin" | "store";
  email?: string | null;
  displayName?: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = variant === "store" ? STORE_NAV : ADMIN_NAV;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/admin/products") return pathname === "/admin/products";
    if (href === "/shop") return pathname === "/shop";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <div className="relative min-h-screen p-3 sm:p-5">
      <div className="app-bg" />
      <div className="app-grain" />

      <div className="glass mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1240px] flex-col overflow-hidden rounded-[26px] sm:min-h-[calc(100vh-2.5rem)] md:grid md:grid-cols-[228px_1fr]">
        {/* ── sidebar ── */}
        <aside className="flex flex-col gap-1 border-b border-white/40 bg-gradient-to-b from-white/40 to-white/10 p-4 md:border-b-0 md:border-r">
          <Link href="/" className="flex items-center gap-2.5 px-2 pb-4 pt-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent-500 to-[#8f7fd8] text-sm text-white">铺</span>
            <span className="text-[17px] font-semibold text-paper-900">我的小店</span>
          </Link>
          <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
            {nav.map((t) => {
              const active = isActive(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-white font-medium text-paper-900 shadow-[0_8px_18px_-10px_rgba(46,52,84,.4)]"
                      : "text-paper-600 hover:bg-white/50 hover:text-paper-900"
                  }`}
                >
                  <svg className={`h-[18px] w-[18px] ${active ? "text-accent-500" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={t.d} />
                  </svg>
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto hidden items-center gap-2.5 rounded-2xl bg-white/40 p-2.5 md:flex">
            <span className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-accent-200 to-[#d8b8cf]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-paper-900">{displayName ?? (variant === "store" ? "门店" : "仓库")}</p>
              <p className="truncate text-[11px] text-paper-400">{email}</p>
            </div>
            <form action={signOut}>
              <button type="submit" aria-label="退出登录" className="rounded-lg p-1.5 text-paper-400 transition-colors hover:bg-white/60 hover:text-paper-700">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </form>
          </div>
        </aside>

        {/* ── main ── */}
        <main className="flex min-w-0 flex-col gap-4 overflow-auto p-5 sm:p-7">{children}</main>
      </div>
    </div>
  );
}
