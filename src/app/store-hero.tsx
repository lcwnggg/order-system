"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/** 鼠标到按钮中心多远以内开始点亮（px） */
const GLOW_RADIUS = 260;
/** 每帧向目标值逼近的比例（越小越“拖尾”，越顺滑） */
const SMOOTH = 0.16;

export default function StoreHero({ storeName }: { storeName: string | null }) {
  const rootRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLAnchorElement>(null);
  const ghostRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // 光斑与按钮点亮的平滑动画完全用 JS 驱动：
    // Chrome 对“过渡自定义属性(@property)”在本场景会卡住，改用 rAF 手动插值。
    const st = {
      on: 0,
      tOn: 0,
      lit: [0, 0],
      tLit: [0, 0],
      raf: 0,
      running: false,
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const write = () => {
      root.style.setProperty("--on", st.on.toFixed(3));
      primaryRef.current?.style.setProperty("--lit", st.lit[0].toFixed(3));
      ghostRef.current?.style.setProperty("--lit", st.lit[1].toFixed(3));
    };

    const frame = () => {
      const k = reduce ? 1 : SMOOTH;
      st.on += (st.tOn - st.on) * k;
      st.lit[0] += (st.tLit[0] - st.lit[0]) * k;
      st.lit[1] += (st.tLit[1] - st.lit[1]) * k;
      write();
      const settled =
        Math.abs(st.tOn - st.on) < 0.002 &&
        Math.abs(st.tLit[0] - st.lit[0]) < 0.002 &&
        Math.abs(st.tLit[1] - st.lit[1]) < 0.002;
      if (settled) {
        st.on = st.tOn;
        st.lit[0] = st.tLit[0];
        st.lit[1] = st.tLit[1];
        write();
        st.running = false;
        return;
      }
      st.raf = requestAnimationFrame(frame);
    };

    const run = () => {
      if (!st.running) {
        st.running = true;
        st.raf = requestAnimationFrame(frame);
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = root.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // 光斑位置直接跟手（不平滑，保证贴合鼠标）
      root.style.setProperty("--mx", `${x}px`);
      root.style.setProperty("--my", `${y}px`);
      st.tOn = 1;
      // 每个按钮按与鼠标的距离设定点亮目标
      const btns = [primaryRef.current, ghostRef.current];
      for (let i = 0; i < btns.length; i++) {
        const el = btns[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - rect.left;
        const cy = r.top + r.height / 2 - rect.top;
        const dist = Math.hypot(x - cx, y - cy);
        st.tLit[i] = Math.max(0, Math.min(1, 1 - dist / GLOW_RADIUS));
      }
      run();
    };

    const onLeave = () => {
      st.tOn = 0;
      st.tLit[0] = 0;
      st.tLit[1] = 0;
      run();
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(st.raf);
    };
  }, []);

  return (
    <main
      ref={rootRef}
      className="hero-root relative isolate flex min-h-[70vh] flex-1 flex-col overflow-hidden"
    >
      {/* 顶光渐暗：始终存在，制造纵深 */}
      <div aria-hidden className="hero-vignette" />
      {/* 光斑揭示层：手电筒式的暖白微光核心 + 松林绿环境光晕，只在鼠标附近显现 */}
      <div aria-hidden className="hero-glow" />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.24em] text-ink-text-dim">
          门店订货 — B2B 目录
        </p>
        <h1 className="animate-fade-up mt-6 text-6xl font-normal leading-[1.05] tracking-tight text-ink-text sm:text-7xl">
          {storeName ? `你好，${storeName}。` : "你好。"}
        </h1>
        <p className="animate-fade-up mt-6 max-w-md text-base leading-relaxed text-ink-text-dim [animation-delay:150ms]">
          浏览商品，加入购物车，一键提交。
        </p>
        <div className="animate-fade-up mt-10 flex flex-col items-center gap-3 [animation-delay:280ms] sm:flex-row">
          <Link
            ref={primaryRef}
            href="/shop"
            className="hero-btn-solid rounded-full px-9 py-4 text-base font-medium text-ink-text transition-colors duration-300 hover:bg-ink-600"
          >
            进入商城下单 →
          </Link>
          <Link
            ref={ghostRef}
            href="/shop/orders"
            className="hero-btn-ghost rounded-full border px-7 py-4 text-base font-medium transition-colors duration-300 hover:text-ink-text"
          >
            我的订单
          </Link>
        </div>
      </div>
    </main>
  );
}
