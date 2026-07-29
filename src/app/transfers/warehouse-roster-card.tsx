"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { GroupStore, TransferRequest } from "@/lib/transfers";
import { useTransferRealtime } from "./use-transfer-realtime";
import { StoreRoster } from "./store-roster";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
  useTransferRealtime();

  const openReqs = useMemo(() => requests.filter((r) => r.status === "open"), [requests]);

  return (
    <div className="glass-strong rounded-[22px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-paper-900">{t("transfers.title")}</h2>
          <p className="text-xs text-paper-400">
            {openReqs.length > 0
              ? t("transfers.boardActive", { n: openReqs.length })
              : t("transfers.boardIdle")}
          </p>
        </div>
        <Link href="/admin/orders" className="shrink-0 rounded-lg bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-100">
          {t("whRoster.detail")}
        </Link>
      </div>
      <div className="mt-4">
        <StoreRoster stores={stores} openReqs={openReqs} currentUserId={currentUserId} canDecline={false} />
      </div>
    </div>
  );
}
