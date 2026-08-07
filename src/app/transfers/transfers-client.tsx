"use client";

import { useMemo, useRef, useState, useTransition } from "react";
// Alias: este archivo también usa `new Image()` (DOM) para leer dimensiones al comprimir fotos
import NextImage from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { GroupStore, TransferMode, TransferRequest, TransferStatus } from "@/lib/transfers";
import { useTransferRealtime } from "./use-transfer-realtime";
import { StoreRoster } from "./store-roster";
import { createTransferRequest, setTransferStatus, updateTransferClaim } from "./actions";
import { useImageLightbox } from "@/app/image-lightbox";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { Translate } from "@/lib/i18n/translate";

// 与商品图一致的前端压缩（沿用项目里的做法）
function compressToJpeg(file: File, t: Translate, maxWidth = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 用完要 revoke，否则每选一张图都会在页面存活期间漏一个 blob（项目里其他两处压缩都已这样做）
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(t("transfers.imgProcessFail")));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t("transfers.imgCompressFail")))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(t("transfers.imgReadFail")));
    };
    img.src = objectUrl;
  });
}

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

function StatusPill({ status }: { status: TransferStatus }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {t(STATUS_KEY[status])}
    </span>
  );
}

function ItemThumb({ req, size = "h-11 w-11" }: { req: TransferRequest; size?: string }) {
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
          <NextImage src={req.photoUrl} alt={req.itemText} width={40} height={40} className="h-full w-full object-cover" />
        </button>
        {lightbox.node}
      </>
    );
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-100 to-[#d8c4e8] text-accent-600`}>
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
    </span>
  );
}

export default function TransfersClient({
  requests,
  stores,
  currentStoreId,
}: {
  requests: TransferRequest[];
  stores: GroupStore[];
  currentStoreId: string;
}) {
  const t = useT();
  useTransferRealtime();

  // 全部待认领的 open 请求（含自己发的），按门店归类画到「每家店一个圈」上
  const openReqs = useMemo(() => requests.filter((r) => r.status === "open"), [requests]);

  // 分组
  const board = useMemo(
    () =>
      requests.filter(
        (r) =>
          r.status === "open" &&
          r.requesterStoreId !== currentStoreId &&
          !r.iDeclined &&
          // 收集模式里我已经报过名的，归到「我要备的货」，不再算待回应
          !(r.mode === "multi" && r.myClaimStatus)
      ),
    [requests, currentStoreId]
  );
  const myClaims = useMemo(
    () =>
      requests.filter((r) =>
        r.mode === "multi"
          ? r.myClaimStatus === "claimed" && r.status === "open"
          : r.claimedBy === currentStoreId && r.status === "claimed"
      ),
    [requests, currentStoreId]
  );
  const myRequests = useMemo(
    () =>
      requests
        .filter((r) => r.requesterStoreId === currentStoreId && r.status !== "done" && r.status !== "cancelled")
        .concat(
          requests.filter(
            (r) => r.requesterStoreId === currentStoreId && (r.status === "done" || r.status === "cancelled")
          )
        ),
    [requests, currentStoreId]
  );

  return (
    <div className="space-y-6">
      <NewRequestForm />

      {/* ── 互调看板：每家店一个圈，缺货的店头上浮现气泡 ── */}
      <section>
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-paper-900">{t("transfers.boardTitle")}</h2>
          <span className="text-xs text-paper-400">
            {board.length > 0 ? t("transfers.boardActive", { n: board.length }) : t("transfers.boardIdle")}
          </span>
        </div>
        <StoreRoster stores={stores} openReqs={openReqs} currentUserId={currentStoreId} />
      </section>

      {/* ── 我要备的货 ── */}
      {myClaims.length > 0 && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            <h2 className="text-sm font-semibold text-blue-800">{t("transfers.myClaims")}</h2>
            <span className="text-xs text-blue-600">{t("transfers.myClaimsHint")}</span>
          </div>
          <div className="space-y-2.5">
            {myClaims.map((req) => (
              <ClaimRow key={req.id} req={req} />
            ))}
          </div>
        </section>
      )}

      {/* ── 我发出的互调 ── */}
      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-paper-900">{t("transfers.mySent")}</h2>
          <span className="text-xs text-paper-400">{t("transfers.mySentCount", { n: myRequests.length })}</span>
        </div>
        {myRequests.length === 0 ? (
          <div className="glass-flat rounded-2xl py-10 text-center">
            <p className="text-sm text-paper-500">{t("transfers.mySentEmpty")}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {myRequests.map((req) => (
              <MyRequestRow key={req.id} req={req} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────── 发起互调 ──────────────────────
function NewRequestForm() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [itemText, setItemText] = useState("");
  const [mode, setMode] = useState<TransferMode>("single");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadPhase("uploading");
      setError(null);
      const blob = await compressToJpeg(file, t);
      const supabase = createClient();
      const fileName = `transfers/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("product-images")
        .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
      setPhotoUrl(data.publicUrl);
      setUploadPhase("idle");
    } catch (err) {
      setUploadPhase("error");
      setError(err instanceof Error ? err.message : t("transfers.imgUploadFail"));
    }
  }

  function reset() {
    setItemText("");
    setMode("single");
    setQuantity("");
    setNote("");
    setPhotoUrl(null);
    setUploadPhase("idle");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit() {
    if (!itemText.trim()) {
      setError(t("transfers.itemRequired"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createTransferRequest({
        itemText: itemText.trim(),
        photoUrl,
        quantity: quantity.trim() ? Number(quantity) : null,
        note: note.trim() || null,
        mode,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      reset();
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 px-5 py-3.5 text-sm font-medium text-white shadow-[0_10px_24px_-12px_rgba(91,111,214,.8)] transition-colors hover:bg-accent-600"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        {t("transfers.newCta")}
      </button>
    );
  }

  return (
    <div className="glass-strong rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-paper-900">{t("transfers.newTitle")}</h2>
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="text-xs text-paper-400 hover:text-paper-700">
          {t("common.cancel")}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-paper-600">{t("transfers.itemLabel")}</label>
          <textarea
            value={itemText}
            onChange={(e) => setItemText(e.target.value)}
            rows={2}
            placeholder={t("transfers.itemPlaceholder")}
            className="w-full resize-none rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-sm text-paper-900 outline-none transition-colors placeholder:text-paper-400 focus:border-accent-500"
          />
        </div>

        {/* 一家店给 vs 所有店都给（例：这个型号的壳，谁有多少我都要） */}
        <div>
          <label className="mb-1 block text-xs font-medium text-paper-600">{t("transfers.modeLabel")}</label>
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={mode === "single"}
              onClick={() => setMode("single")}
              title={t("transfers.modeSingle")}
              hint={t("transfers.modeSingleHint")}
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              }
            />
            <ModeCard
              active={mode === "multi"}
              onClick={() => setMode("multi")}
              title={t("transfers.modeMulti")}
              hint={t("transfers.modeMultiHint")}
              icon={
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              }
            />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-paper-600">
              {mode === "multi" ? t("transfers.quantityMax") : t("transfers.quantity")}
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={mode === "multi" ? t("transfers.quantityAll") : t("transfers.quantityPlaceholder")}
              className="w-full rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-sm text-paper-900 outline-none transition-colors placeholder:text-paper-400 focus:border-accent-500"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-paper-600">{t("transfers.note")}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("transfers.notePlaceholder")}
              className="w-full rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-sm text-paper-900 outline-none transition-colors placeholder:text-paper-400 focus:border-accent-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-paper-600">{t("transfers.photo")}</label>
          <div className="flex items-center gap-3">
            {photoUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-paper-900/10" />
                <button
                  type="button"
                  onClick={() => { setPhotoUrl(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-paper-800 text-white"
                  aria-label={t("transfers.deletePhoto")}
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ) : (
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border border-dashed border-paper-300 text-paper-400 transition-colors hover:border-accent-500 hover:text-accent-500">
                {uploadPhase === "uploading" ? (
                  <span className="text-[10px]">{t("transfers.uploading")}</span>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </label>
            )}
            <p className="text-xs text-paper-400">{t("transfers.photoHint")}</p>
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          type="button"
          disabled={pending || uploadPhase === "uploading"}
          onClick={handleSubmit}
          className="w-full rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
        >
          {pending
            ? t("transfers.sending")
            : mode === "multi"
              ? t("transfers.broadcastMulti")
              : t("transfers.broadcast")}
        </button>
      </div>
    </div>
  );
}

// 发起时选「一家店 / 所有店」的卡片
function ModeCard({
  active,
  onClick,
  title,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors ${
        active
          ? "border-accent-500 bg-accent-50/70 text-paper-900"
          : "border-paper-200 bg-white/60 text-paper-600 hover:border-paper-300"
      }`}
    >
      <svg
        className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-accent-600" : "text-paper-400"}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        {icon}
      </svg>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-tight text-paper-500">{hint}</span>
      </span>
    </button>
  );
}

// ────────────────────── 我要备的货 ──────────────────────
function ClaimRow({ req }: { req: TransferRequest }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isMulti = req.mode === "multi";

  function act(status: "done" | "open") {
    setError(null);
    startTransition(async () => {
      // 收集模式里「已交货 / 退回」只动我自己报的那一份，请求对别家继续开放
      const res = isMulti
        ? await updateTransferClaim(req.id, status === "done" ? "done" : "withdraw")
        : await setTransferStatus(req.id, status);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/80 p-3 ring-1 ring-blue-100">
      <ItemThumb req={req} size="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-paper-900">{req.itemText}</p>
        <p className="mt-0.5 text-[11.5px] text-paper-500">
          {t("transfers.forStore")}{" "}
          <span className="font-medium text-paper-700">{req.requesterName ?? t("transfers.someStore")}</span>
          {isMulti && (
            <span className="ml-1 rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-600">
              {t("transfers.modeMultiTag")}
            </span>
          )}
          {isMulti
            ? req.myClaimQuantity
              ? ` · ${t("transfers.iOffered", { n: req.myClaimQuantity })}`
              : ` · ${t("transfers.iOfferedNoQty")}`
            : req.quantity
              ? ` · ${t("transfers.qtyUnits", { n: req.quantity })}`
              : ""}
          {req.note ? ` · ${req.note}` : ""}
        </p>
        {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => act("open")}
          className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-paper-400 transition-colors hover:text-paper-700 disabled:opacity-50"
        >
          {isMulti ? t("transfers.withdraw") : t("transfers.giveBack")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => act("done")}
          className="inline-flex items-center gap-1 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          {pending ? "…" : t("transfers.delivered")}
        </button>
      </div>
    </div>
  );
}

// ────────────────────── 我发出的互调 ──────────────────────
function MyRequestRow({ req }: { req: TransferRequest }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isMulti = req.mode === "multi";

  function act(status: "cancelled" | "done") {
    setError(null);
    startTransition(async () => {
      const res = await setTransferStatus(req.id, status);
      if (res.error) setError(res.error);
    });
  }

  const dim = req.status === "done" || req.status === "cancelled";
  // 收集模式：谁报了名、各能给几件；总数用来判断「够了没」
  const offeredTotal = req.claims.reduce((sum, c) => sum + (c.quantity ?? 0), 0);

  return (
    <div className={`rounded-xl p-3 ring-1 ring-paper-900/10 ${dim ? "bg-white/50" : "glass-flat"}`}>
      <div className="flex items-center gap-3">
      <ItemThumb req={req} size="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-paper-900">{req.itemText}</p>
          <StatusPill status={req.status} />
          {isMulti && (
            <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-600">
              {t("transfers.modeMultiTag")}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11.5px] text-paper-500">
          {req.status === "open" &&
            (isMulti
              ? req.claims.length === 0
                ? t("transfers.stateCollectingEmpty")
                : t("transfers.stateCollecting", { n: req.claims.length })
              : t("transfers.stateOpen"))}
          {req.status === "claimed" && (
            <>
              <span className="font-medium text-blue-700">{req.claimerName ?? t("transfers.someStore")}</span>
              {t("transfers.stateClaimedSuffix")}
            </>
          )}
          {req.status === "done" &&
            (isMulti ? (
              t("transfers.stateCollectedDone", { n: req.claims.length })
            ) : (
              <>
                <span className="font-medium text-mint-600">{req.claimerName ?? t("transfers.someStore")}</span>
                {t("transfers.stateDoneSuffix")}
              </>
            ))}
          {req.status === "cancelled" && t("transfers.stateCancelled")}
          {req.quantity ? ` · ${t("transfers.qtyUnits", { n: req.quantity })}` : ""}
        </p>
        {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      </div>
      {(req.status === "open" || req.status === "claimed") && (
        <button
          type="button"
          disabled={pending}
          onClick={() => act("cancelled")}
          className="shrink-0 rounded-lg border border-paper-200 px-2.5 py-1.5 text-[11px] font-medium text-paper-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
        >
          {pending ? "…" : t("transfers.cancel")}
        </button>
      )}
      </div>

      {/* 收集模式：谁有几件的清单 + 「ya está, cerrar」 */}
      {isMulti && req.claims.length > 0 && (
        <div className="mt-2.5 rounded-xl bg-white/60 p-2.5 ring-1 ring-paper-900/5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold text-paper-700">
              {t("transfers.offersTitle", { n: req.claims.length })}
            </p>
            {offeredTotal > 0 && (
              <p className="text-[11px] text-paper-500">{t("transfers.offersTotal", { n: offeredTotal })}</p>
            )}
          </div>
          <ul className="space-y-1">
            {req.claims.map((c) => (
              <li key={c.storeId} className="flex items-center gap-2 text-[11.5px]">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.status === "done" ? "bg-mint-500" : "bg-blue-500"}`}
                />
                <span className="min-w-0 flex-1 truncate text-paper-700">
                  {c.storeName ?? t("transfers.someStore")}
                </span>
                <span className="shrink-0 text-paper-500">
                  {c.quantity ? t("transfers.qtyUnits", { n: c.quantity }) : t("transfers.qtyUnknown")}
                </span>
                <span className={`shrink-0 ${c.status === "done" ? "text-mint-600" : "text-blue-600"}`}>
                  {c.status === "done" ? t("transferStatus.done") : t("transferStatus.claimed")}
                </span>
              </li>
            ))}
          </ul>
          {req.status === "open" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => act("done")}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-mint-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              {pending ? "…" : t("transfers.closeCollection")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
