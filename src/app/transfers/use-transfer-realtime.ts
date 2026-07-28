"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * 订阅 transfer_requests 的实时变化：任意新增/更新都触发 router.refresh()，
 * 让服务端组件重新取数、无刷新更新看板。RLS 保证只收到本仓库分组的行。
 * 进不来 realtime（如网络受限）时静默降级，页面仍可手动刷新。
 */
export function useTransferRealtime(onChange?: () => void) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("transfer_requests_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transfer_requests" },
        () => {
          router.refresh();
          onChange?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // onChange 用 ref 语义即可；这里只在挂载时订阅一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
}
