"use client";

import { useMemo, useState } from "react";
import type { TransferRequest, TransferStatus } from "@/lib/transfers";
import { useTransferRealtime } from "@/app/transfers/use-transfer-realtime";

const STATUS_LABEL: Record<TransferStatus, string> = {
  open: "找货中",
  claimed: "备货中",
  done: "已交货",
  cancelled: "已撤销",
};
const STATUS_PILL: Record<TransferStatus, string> = {
  open: "bg-accent-50 text-accent-600",
  claimed: "bg-blue-50 text-blue-700",
  done: "bg-mint-50 text-mint-600",
  cancelled: "bg-paper-100 text-paper-500",
};
const STATUS_DOT: Record<TransferStatus, string> = {
  open: "bg-accent-500",
  claimed: "bg-blue-500",
  done: "bg-mint-500",
  cancelled: "bg-paper-400",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * 仓库端「门店互调」监看面板：折叠进订单管理页顶部。
 * 仓库不参与认领，只需看到门店之间在调什么货、到哪一步了——
 * 和自己的订单在同一屏里，一眼看全。
 */
export default function WarehouseTransferPanel({ requests }: { requests: TransferRequest[] }) {
  useTransferRealtime();
  const [collapsed, setCollapsed] = useState(false);

  const active = useMemo(
    () => requests.filter((r) => r.status === "open" || r.status === "claimed"),
    [requests]
  );
  const openCount = active.filter((r) => r.status === "open").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-accent-200 bg-accent-50/50">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-3 px-5 pt-4 pb-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-accent-800">
            门店互调
            {openCount > 0 && (
              <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {openCount} 条找货中
              </span>
            )}
          </h2>
          <p className="text-xs text-accent-600/80">门店之间互相调货的动态（仅监看）</p>
        </div>
        <svg className={`h-4 w-4 shrink-0 text-accent-500 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {!collapsed && (
        <div className="px-5 pb-4">
          {active.length === 0 ? (
            <p className="py-2 text-sm text-accent-600/80">暂无进行中的门店互调</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {active.map((req) => (
                <div key={req.id} className="flex items-center gap-3 rounded-xl bg-white/80 p-3 ring-1 ring-accent-100">
                  {req.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={req.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-paper-900/10" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-paper-900">{req.itemText}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-paper-500">
                      <span className="text-paper-700">{req.requesterName ?? "某门店"}</span> 求
                      {req.quantity ? ` ${req.quantity} 件` : ""}
                      {req.status === "claimed" && (
                        <> · <span className="text-blue-700">{req.claimerName ?? "某门店"}</span> 在备</>
                      )}
                      {" · "}
                      {timeAgo(req.createdAt)}
                    </p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[req.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[req.status]}`} />
                    {STATUS_LABEL[req.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
