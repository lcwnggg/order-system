"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { GroupStore, TransferRequest } from "@/lib/transfers";
import { useTransferRealtime } from "./use-transfer-realtime";
import { StoreRoster } from "./store-roster";

/**
 * 仓库仪表盘上的互调看板：跟门店看到的一样（每家店一个小屋），
 * 但仓库不显示「我没有」——那是门店对自己库存的判断，仓库只负责「我有」认领。
 */
export default function WarehouseRosterCard({
  requests,
  stores,
  currentUserId,
}: {
  requests: TransferRequest[];
  stores: GroupStore[];
  currentUserId: string;
}) {
  useTransferRealtime();

  const openReqs = useMemo(() => requests.filter((r) => r.status === "open"), [requests]);

  return (
    <div className="glass-strong rounded-[22px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-paper-900">门店互调</h2>
          <p className="text-xs text-paper-400">
            {openReqs.length > 0 ? `${openReqs.length} 家店在找货，把鼠标滑到店头上的气泡` : "各门店缺货会浮现在这里"}
          </p>
        </div>
        <Link href="/admin/orders" className="shrink-0 rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-100">
          备货详情 →
        </Link>
      </div>
      <div className="mt-4">
        <StoreRoster stores={stores} openReqs={openReqs} currentUserId={currentUserId} canDecline={false} />
      </div>
    </div>
  );
}
