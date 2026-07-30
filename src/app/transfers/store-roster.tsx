"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import type { GroupStore, TransferRequest } from "@/lib/transfers";
import { claimTransferRequest, declineTransferRequest } from "./actions";
import { useImageLightbox } from "@/app/image-lightbox";
import { useT } from "@/lib/i18n/client";
import { useTimeAgo } from "./time-ago";

function ItemThumb({ req, size = "h-9 w-9" }: { req: TransferRequest; size?: string }) {
  const t = useT();
  const lightbox = useImageLightbox();

  if (req.photoUrl) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            lightbox.open(req.photoUrl, req.itemText);
          }}
          title={t("common.viewPhoto", { name: req.itemText })}
          className={`${size} shrink-0 cursor-zoom-in overflow-hidden rounded-xl ring-1 ring-paper-900/10 transition hover:ring-paper-400`}
        >
          <Image src={req.photoUrl} alt={req.itemText} width={36} height={36} className="h-full w-full object-cover" />
        </button>
        {lightbox.node}
      </>
    );
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-100 to-[#d8c4e8] text-accent-600`}>
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
    </span>
  );
}

// 小屋插画：尖顶 + 烟囱 + 圆窗 + 门，三种配色（自己 / 别家有货 / 空闲）
function HouseShop({ variant }: { variant: "idle" | "active" | "me" }) {
  const c =
    variant === "me"
      ? { wall: "#ffffff", stroke: "rgba(27,32,48,.08)", glass: "#dfe4f7", door: "#4a5cc0", roof: "#5b6fd6", roofShade: "#4a5cc0", chimney: "#4a5cc0" }
      : variant === "active"
        ? { wall: "#ffffff", stroke: "rgba(27,32,48,.08)", glass: "#d7e8e0", door: "#495069", roof: "#5fa98c", roofShade: "#4d9077", chimney: "#4d9077" }
        : { wall: "#eef0f7", stroke: "rgba(27,32,48,.10)", glass: "#d6dbe9", door: "#9aa2ba", roof: "#c3cadd", roofShade: "#b0b9d8", chimney: "#b0b9d8" };
  return (
    <svg viewBox="0 0 72 68" className="h-full w-full" aria-hidden="true">
      {/* 地面投影 */}
      <ellipse cx="36" cy="64" rx="22" ry="2.8" fill="rgba(27,32,48,.08)" />
      {/* 墙体 */}
      <rect x="18" y="32" width="36" height="28" rx="3" fill={c.wall} stroke={c.stroke} strokeWidth="1" />
      {/* 窗 */}
      <rect x="22" y="37" width="8" height="8" rx="1.4" fill={c.glass} />
      {/* 门 */}
      <rect x="31" y="44" width="10" height="16" rx="1.4" fill={c.door} />
      {/* 屋顶（两面，带阴影面） */}
      <path d="M14,33 L36,13 L58,33 Z" fill={c.roof} />
      <path d="M36,13 L58,33 L52,33 L36,19 Z" fill={c.roofShade} />
      {/* 圆窗 */}
      <circle cx="36" cy="26" r="3.2" fill={c.glass} />
      {/* 烟囱 */}
      <rect x="45" y="16" width="6" height="11" rx="1" fill={c.chimney} />
    </svg>
  );
}

/**
 * 互调看板：每家门店一个小屋，缺货的店头上浮现气泡。
 * 门店页 / 仓库仪表盘共用；canDecline=false 时隐藏「我没有」
 * （仓库不该替某家门店回答「有没有」，只应「仓库有货，我来」）。
 */
export function StoreRoster({
  stores,
  openReqs,
  currentUserId,
  canDecline = true,
}: {
  stores: GroupStore[];
  openReqs: TransferRequest[];
  currentUserId: string;
  canDecline?: boolean;
}) {
  const t = useT();
  // 门店 → 该店发出的、仍待认领的请求
  const byStore = useMemo(() => {
    const m = new Map<string, TransferRequest[]>();
    for (const r of openReqs) {
      const arr = m.get(r.requesterStoreId);
      if (arr) arr.push(r);
      else m.set(r.requesterStoreId, [r]);
    }
    return m;
  }, [openReqs]);

  // 名册里若少了某些发起店（理论上不会），兜底补上，保证气泡都有落点
  const roster = useMemo(() => {
    const ids = new Set(stores.map((s) => s.id));
    const extra: GroupStore[] = [];
    for (const r of openReqs) {
      if (!ids.has(r.requesterStoreId)) {
        ids.add(r.requesterStoreId);
        extra.push({ id: r.requesterStoreId, name: r.requesterName });
      }
    }
    return [...stores, ...extra];
  }, [stores, openReqs]);

  if (roster.length === 0) {
    return (
      <div className="glass-flat rounded-2xl py-12 text-center">
        <p className="text-sm text-paper-500">{t("roster.noStores")}</p>
      </div>
    );
  }

  return (
    <div className="glass-flat rounded-2xl px-4 pb-5 pt-14 sm:px-6">
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-10 sm:gap-x-9">
        {roster.map((store) => (
          <StoreNode
            key={store.id}
            store={store}
            reqs={byStore.get(store.id) ?? []}
            isMe={store.id === currentUserId}
            canDecline={canDecline}
          />
        ))}
      </div>
    </div>
  );
}

function StoreNode({
  store,
  reqs,
  isMe,
  canDecline,
}: {
  store: GroupStore;
  reqs: TransferRequest[];
  isMe: boolean;
  canDecline: boolean;
}) {
  const t = useT();
  const timeAgo = useTimeAgo();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const active = reqs.length > 0;
  const name = store.name ?? t("transfers.someStore");
  // 自己的店不能认领自己的货；别家店可 ✓（仓库不显示 ✗，见 canDecline）
  const actionable = active && !isMe;

  function act(id: string, fn: () => Promise<{ error?: string }>) {
    setPendingId(id);
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setPendingId(null);
      if (res.error) setError(res.error);
      else setOpen(false);
    });
  }

  return (
    <div
      className="group relative flex w-20 flex-col items-center"
      onMouseEnter={() => active && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* 头上的气泡 */}
      {active && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="animate-bubble-pop absolute -top-11 left-1/2 z-10 -translate-x-1/2 cursor-pointer"
          aria-label={t("roster.searchingAria", { name })}
        >
          <span className="animate-bubble-bob block">
            <span
              className={`relative block max-w-[120px] truncate rounded-2xl px-2.5 py-1 text-[11px] font-medium shadow-[0_10px_20px_-10px_rgba(46,52,84,.5)] ${
                isMe ? "bg-accent-500 text-white" : "bg-white text-paper-800 ring-1 ring-accent-200"
              }`}
            >
              {reqs.length > 1 ? t("roster.bubbleMulti", { n: reqs.length }) : reqs[0].itemText}
              {/* 小尾巴 */}
              <span
                className={`absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 ${
                  isMe ? "bg-accent-500" : "bg-white ring-1 ring-accent-200"
                }`}
              />
            </span>
          </span>
        </button>
      )}

      {/* 门店小屋 */}
      <span className="relative flex h-[68px] w-[76px] items-end justify-center">
        {active && (
          <span
            className={`animate-ring-pulse absolute inset-x-2 bottom-1 top-7 rounded-[18px] ${isMe ? "bg-accent-500" : "bg-mint-500"}`}
          />
        )}
        <span
          className={`relative block h-[68px] w-[76px] transition-transform duration-200 group-hover:-translate-y-1 ${
            active ? "" : "opacity-55 saturate-50"
          }`}
        >
          <HouseShop variant={isMe ? "me" : active ? "active" : "idle"} />
          {active && (
            <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white ring-2 ring-[#eef0f7]">
              {reqs.length}
            </span>
          )}
        </span>
      </span>

      {/* 店名 */}
      <span className={`mt-1 max-w-[76px] truncate text-center text-[11px] ${isMe ? "font-semibold text-accent-600" : "text-paper-600"}`}>
        {isMe ? t("roster.you", { name }) : name}
      </span>

      {/* 展开：该店所有待认领请求 + ✓/✗ */}
      {open && active && (
        <div className="absolute top-[92px] left-1/2 z-20 w-56 -translate-x-1/2 rounded-2xl glass-strong p-3 shadow-[0_20px_40px_-16px_rgba(46,52,84,.5)]">
          <p className="mb-2 text-[11px] font-medium text-paper-500">
            {isMe ? t("roster.youSearching") : t("roster.storeSearching", { name })}
          </p>
          <div className="space-y-2">
            {reqs.map((req) => (
              <div key={req.id} className="rounded-xl bg-white/70 p-2 ring-1 ring-paper-900/5">
                <div className="flex gap-2">
                  <ItemThumb req={req} size="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium text-paper-900">{req.itemText}</p>
                    <p className="mt-0.5 text-[10.5px] text-paper-400">
                      {req.quantity ? t("roster.needQty", { n: req.quantity }) : ""}
                      {timeAgo(req.createdAt)}
                    </p>
                  </div>
                </div>
                {req.note && <p className="mt-1 line-clamp-1 text-[10.5px] text-paper-500">📝 {req.note}</p>}
                {actionable && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      disabled={pendingId === req.id}
                      onClick={() => act(req.id, () => claimTransferRequest(req.id))}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-mint-500 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      {t("roster.iHave")}
                    </button>
                    {canDecline && (
                      <button
                        type="button"
                        disabled={pendingId === req.id}
                        onClick={() => act(req.id, () => declineTransferRequest(req.id))}
                        className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-paper-200 bg-white/70 px-2 py-1.5 text-[11px] font-medium text-paper-500 transition-colors hover:text-paper-700 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        {t("roster.iDontHave")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {error && <p className="mt-1.5 text-[10.5px] text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
