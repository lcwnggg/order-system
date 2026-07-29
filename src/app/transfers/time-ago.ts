"use client";

import { useCallback } from "react";
import { useT } from "@/lib/i18n/client";

/**
 * 「刚刚 / 5 分钟前」这类相对时间。原本在互调面板和看板里各抄了一份，
 * 翻译时抽出来共用，免得两处文案走样。
 */
export function useTimeAgo(): (iso: string) => string {
  const t = useT();

  return useCallback(
    (iso: string) => {
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60000);
      if (m < 1) return t("time.justNow");
      if (m < 60) return t("time.minutesAgo", { n: m });
      const h = Math.floor(m / 60);
      if (h < 24) return t("time.hoursAgo", { n: h });
      return t("time.daysAgo", { n: Math.floor(h / 24) });
    },
    [t]
  );
}
