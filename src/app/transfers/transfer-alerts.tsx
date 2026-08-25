"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";

// 用 Web Audio 生成一声轻提示音，免依赖、免音频文件。
// 浏览器要求「用户手势」后才能出声，所以点铃铛时会解锁 AudioContext。
let audioCtx: AudioContext | null = null;

function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    void audioCtx.resume();
  } catch {
    /* 忽略 */
  }
}

function beep() {
  try {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    // 两声「叮-咚」
    [880, 1174].forEach((freq, i) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.connect(g);
      g.connect(audioCtx!.destination);
      o.type = "sine";
      o.frequency.value = freq;
      const t = now + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.start(t);
      o.stop(t + 0.34);
    });
  } catch {
    /* 忽略 */
  }
}

type NewRow = {
  id?: string;
  status?: string;
  requester_store_id?: string;
  item_text?: string;
  reopened_at?: string | null;
};

/**
 * 「开启提示音」铃铛：开启后，本仓库分组里有【新的待认领请求】时
 * 播放提示音 + 弹系统通知（需一次「允许通知」）。App 开着（含后台标签页）时有效。
 */
export default function TransferAlerts({ currentUserId }: { currentUserId: string }) {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  // 实时回调闭包只在挂载时建立一次，用 ref 拿到最新的 t，避免语言切换后通知还是旧语言
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // 把最新的 enabled 同步到 ref，供实时回调 / 手势监听读取（避免重订阅）
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    // 仅客户端：挂载后读一次浏览器里的偏好
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem("transferAlerts") === "on") setEnabled(true);
  }, []);

  // «Volver a solicitar» ya anunciados, para no repetir el aviso con cada
  // actualización posterior de la misma petición.
  const announcedReopens = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();

    // 开着提示但刚打开页面时，首次点击任意处解锁声音（浏览器策略）
    const onFirstGesture = () => {
      if (enabledRef.current) unlockAudio();
      window.removeEventListener("pointerdown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture);

    /** Avisa igual venga de un alta o de un «volver a solicitar». */
    function announce(row: NewRow) {
      if (!enabledRef.current) return;
      if (row.status !== "open") return;
      if (row.requester_store_id === currentUserId) return; // 自己发的不提醒
      beep();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(tRef.current("alerts.notifTitle"), {
            body: row.item_text ?? tRef.current("alerts.notifBody"),
            tag: "transfer-request",
          });
        } catch {
          /* 忽略 */
        }
      }
    }

    const channel = supabase
      .channel("transfer_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "transfer_requests" },
        (payload) => announce(payload.new as NewRow)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transfer_requests" },
        (payload) => {
          // Una petición se actualiza por muchos motivos (alguien se apunta,
          // cambia de estado…). Solo canta la que acaban de volver a preguntar,
          // y una sola vez por repetición: `reopened_at` cambia en cada una.
          const row = payload.new as NewRow;
          if (!row.reopened_at || !row.id) return;
          // Además tiene que ser de ahora mismo: si no, apuntarse a una
          // petición repetida hace días también sonaría.
          if (Date.now() - new Date(row.reopened_at).getTime() > 120000) return;
          const key = `${row.id}@${row.reopened_at}`;
          if (announcedReopens.current.has(key)) return;
          announcedReopens.current.add(key);
          announce(row);
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  async function enable() {
    unlockAudio();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* 忽略 */
      }
    }
    setEnabled(true);
    localStorage.setItem("transferAlerts", "on");
    beep(); // 确认音
  }

  function disable() {
    setEnabled(false);
    localStorage.setItem("transferAlerts", "off");
  }

  return (
    <button
      type="button"
      onClick={enabled ? disable : enable}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
        enabled
          ? "bg-accent-500 text-white hover:bg-accent-600"
          : "border border-accent-200 bg-white/70 text-accent-600 hover:bg-accent-50"
      }`}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {enabled ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.73 21a2 2 0 01-3.46 0M18.63 13A17.888 17.888 0 0118 8m-6-4a2 2 0 00-2 2c0 .28.02.55.05.82M5 5l14 14" />
        )}
      </svg>
      {enabled ? t("alerts.on") : t("alerts.off")}
    </button>
  );
}
