"use client";

import { useEffect, useRef } from "react";

/** 登录页背景：与门店首页同一套暗色手电筒光斑，只是没有按钮需要单独点亮 */
export default function LoginHeroBg({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const st = { on: 0, tOn: 0, raf: 0, running: false };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const write = () => root.style.setProperty("--on", st.on.toFixed(3));

    const frame = () => {
      const k = reduce ? 1 : 0.16;
      st.on += (st.tOn - st.on) * k;
      write();
      if (Math.abs(st.tOn - st.on) < 0.002) {
        st.on = st.tOn;
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
      root.style.setProperty("--mx", `${e.clientX - rect.left}px`);
      root.style.setProperty("--my", `${e.clientY - rect.top}px`);
      st.tOn = 1;
      run();
    };
    const onLeave = () => {
      st.tOn = 0;
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
    <div
      ref={rootRef}
      className="hero-root relative isolate flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden px-6 py-12"
    >
      <div aria-hidden className="hero-vignette" />
      <div aria-hidden className="hero-glow" />
      <div className="relative z-10 flex w-full justify-center">{children}</div>
    </div>
  );
}
