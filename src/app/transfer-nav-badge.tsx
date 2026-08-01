"use client";

import { useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type BoardRow = {
  requester_store_id: string;
  status: string;
  i_declined: boolean;
};

/**
 * 门店互调侧栏小红点：自取数、订阅实时更新。
 * 计数 = 待认领(open) 且不是我发起、我也还没回复「没有」的请求。
 * 独立自足，不用把数据穿过每个页面的 AppShell。
 */
export default function TransferNavBadge() {
  const [count, setCount] = useState(0);
  // 频道名要每个实例唯一：同一页可能挂两个徽标（侧栏 + 页面按钮），
  // 同名频道第二次 .on() 会在 subscribe() 之后注册，Supabase 直接抛错让整页崩掉
  const channelId = useId();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function recount() {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      const { data } = await supabase.rpc("get_transfer_board");
      if (cancelled) return;
      const rows = (data as BoardRow[] | null) ?? [];
      setCount(
        rows.filter((r) => r.status === "open" && r.requester_store_id !== uid && !r.i_declined).length
      );
    }

    recount();
    const channel = supabase
      .channel(`transfer_nav_badge:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transfer_requests" },
        () => recount()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  if (count === 0) return null;

  return (
    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">
      {count}
    </span>
  );
}
