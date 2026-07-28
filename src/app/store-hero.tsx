import Link from "next/link";
import { signOut } from "@/app/actions/auth";

export default function StoreHero({ storeName }: { storeName: string | null }) {
  return (
    <main className="relative isolate flex min-h-screen flex-1 flex-col items-center justify-center overflow-hidden px-6 py-24">
      <div className="glass-strong relative w-full max-w-2xl overflow-hidden rounded-[30px] px-8 py-14 text-center sm:px-14">
        {/* 虹彩球点缀（唯一一处鲜艳色） */}
        <div className="iri-ball absolute -right-10 -top-10 h-40 w-40 opacity-70 blur-[1px]" aria-hidden />

        <div className="relative z-10">
          <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.24em] text-paper-500">
            门店订货 — B2B 目录
          </p>
          <h1 className="animate-fade-up mt-6 text-5xl font-semibold leading-[1.05] tracking-tight text-paper-900 sm:text-6xl">
            {storeName ? `你好，${storeName}。` : "你好。"}
          </h1>
          <p className="animate-fade-up mt-6 text-base leading-relaxed text-paper-600 [animation-delay:150ms]">
            浏览商品，加入购物车，一键提交。
          </p>
          <div className="animate-fade-up mt-10 flex flex-col items-center justify-center gap-3 [animation-delay:280ms] sm:flex-row">
            <Link
              href="/shop"
              className="rounded-full bg-paper-800 px-9 py-4 text-base font-medium text-white shadow-[0_16px_30px_-14px_rgba(27,32,48,.7)] transition-colors duration-300 hover:bg-paper-700"
            >
              进入商城下单 →
            </Link>
            <Link
              href="/shop/orders"
              className="rounded-full border border-white/60 bg-white/40 px-7 py-4 text-base font-medium text-paper-700 transition-colors duration-300 hover:bg-white/70"
            >
              我的订单
            </Link>
          </div>

          {/* 退出登录：手机上也要能换账号 */}
          <form action={signOut} className="animate-fade-up mt-8 [animation-delay:360ms]">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-sm text-paper-500 transition-colors hover:text-paper-800"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              退出登录
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
