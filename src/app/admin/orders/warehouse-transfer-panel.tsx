"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import type { TransferRequest, TransferStatus } from "@/lib/transfers";
import { useTransferRealtime } from "@/app/transfers/use-transfer-realtime";
import { claimTransferRequest, setTransferStatus } from "@/app/transfers/actions";
import TransferAlerts from "@/app/transfers/transfer-alerts";
import { useImageLightbox } from "@/app/image-lightbox";
import { useT } from "@/lib/i18n/client";
import { useTimeAgo } from "@/app/transfers/time-ago";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const STATUS_KEY: Record<TransferStatus, TranslationKey> = {
  open: "transferStatus.open",
  claimed: "transferStatus.claimed",
  done: "transferStatus.done",
  cancelled: "transferStatus.cancelled",
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

/**
 * 仓库端「门店互调」面板：折叠进订单管理页顶部。
 * 仓库既能监看门店之间的调货动态，也能在自己有货时直接「我有」认领并备货，
 * 和自己的订单在同一屏里，一眼看全。
 */
export default function WarehouseTransferPanel({
  requests,
  currentUserId,
}: {
  requests: TransferRequest[];
  currentUserId: string;
}) {
  const t = useT();
  useTransferRealtime();
  const [collapsed, setCollapsed] = useState(false);

  const active = useMemo(
    () => requests.filter((r) => r.status === "open" || r.status === "claimed"),
    [requests]
  );
  const openCount = active.filter((r) => r.status === "open").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-accent-200 bg-accent-50/50">
      <div className="flex w-full items-center gap-3 px-5 pt-4 pb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-accent-800">
            {t("transfers.title")}
            {openCount > 0 && (
              <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {t("whTransfer.openCount", { n: openCount })}
              </span>
            )}
          </h2>
          <p className="text-xs text-accent-600/80">{t("whTransfer.subtitle")}</p>
        </div>
        <TransferAlerts currentUserId={currentUserId} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t("common.expand") : t("common.collapse")}
          className="shrink-0 rounded-lg p-1.5 text-accent-500 transition-colors hover:bg-accent-100"
        >
          <svg className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>

      {!collapsed && (
        <div className="px-5 pb-4">
          {active.length === 0 ? (
            <p className="py-2 text-sm text-accent-600/80">{t("whTransfer.empty")}</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {active.map((req) => (
                <PanelCard key={req.id} req={req} currentUserId={currentUserId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PanelCard({ req, currentUserId }: { req: TransferRequest; currentUserId: string }) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const lightbox = useImageLightbox();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const minedByMe = req.claimedBy === currentUserId;

  function act(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white/80 p-3 ring-1 ring-accent-100">
      <div className="flex items-center gap-3">
        {req.photoUrl ? (
          <button
            type="button"
            onClick={() => lightbox.open(req.photoUrl, req.itemText)}
            title={t("common.viewPhoto", { name: req.itemText })}
            className="h-10 w-10 shrink-0 cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-paper-900/10 transition hover:ring-paper-400"
          >
            <Image src={req.photoUrl} alt={req.itemText} width={40} height={40} className="h-full w-full object-cover" />
          </button>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-paper-900">{req.itemText}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-paper-500">
            <span className="text-paper-700">{req.requesterName ?? t("transfers.someStore")}</span>{" "}
            {t("whTransfer.asks")}
            {req.quantity ? ` ${t("transfers.qtyUnits", { n: req.quantity })}` : ""}
            {req.status === "claimed" && !minedByMe && (
              <>
                {" · "}
                <span className="text-blue-700">{req.claimerName ?? t("transfers.someStore")}</span>{" "}
                {t("whTransfer.claimerPreparing")}
              </>
            )}
            {" · "}
            {/* 「5 分钟前」按当前时刻算：这个面板默认展开，会先在服务端渲染一遍，
                请求正好跨过分钟边界时服务端和浏览器算出的文案不一样。这里明确
                告诉 React 这处文本以客户端为准，不要当成水合错误 */}
            <span suppressHydrationWarning>{timeAgo(req.createdAt)}</span>
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[req.status]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[req.status]}`} />
          {minedByMe ? t("whTransfer.meProviding") : t(STATUS_KEY[req.status])}
        </span>
      </div>

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {/* 仓库操作：open 可「我有」认领；自己认领的可「已交货 / 退回」 */}
      {req.status === "open" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => claimTransferRequest(req.id))}
          className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          {t("whTransfer.warehouseHas")}
        </button>
      )}
      {req.status === "claimed" && minedByMe && (
        <div className="flex items-center gap-1.5 self-start">
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => setTransferStatus(req.id, "open"))}
            className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-paper-400 transition-colors hover:text-paper-700 disabled:opacity-50"
          >
            {t("transfers.giveBack")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => setTransferStatus(req.id, "done"))}
            className="inline-flex items-center gap-1 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            {pending ? "…" : t("transfers.delivered")}
          </button>
        </div>
      )}

      {lightbox.node}
    </div>
  );
}
