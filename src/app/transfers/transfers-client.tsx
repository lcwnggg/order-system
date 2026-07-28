"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TransferRequest, TransferStatus } from "@/lib/transfers";
import { useTransferRealtime } from "./use-transfer-realtime";
import {
  createTransferRequest,
  claimTransferRequest,
  declineTransferRequest,
  setTransferStatus,
} from "./actions";

// 与商品图一致的前端压缩（沿用项目里的做法）
function compressToJpeg(file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("无法处理图片"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = URL.createObjectURL(file);
  });
}

const STATUS_LABEL: Record<TransferStatus, string> = {
  open: "待认领",
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

function StatusPill({ status }: { status: TransferStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function ItemThumb({ req, size = "h-11 w-11" }: { req: TransferRequest; size?: string }) {
  if (req.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={req.photoUrl} alt="" className={`${size} shrink-0 rounded-xl object-cover ring-1 ring-paper-900/10`} />;
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-100 to-[#d8c4e8] text-accent-600`}>
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" /></svg>
    </span>
  );
}

export default function TransfersClient({
  requests,
  currentStoreId,
}: {
  requests: TransferRequest[];
  currentStoreId: string;
}) {
  useTransferRealtime();

  // 分组
  const board = useMemo(
    () =>
      requests.filter(
        (r) => r.status === "open" && r.requesterStoreId !== currentStoreId && !r.iDeclined
      ),
    [requests, currentStoreId]
  );
  const myClaims = useMemo(
    () => requests.filter((r) => r.claimedBy === currentStoreId && r.status === "claimed"),
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

      {/* ── 互调看板 ── */}
      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-paper-900">互调看板</h2>
          <span className="text-xs text-paper-400">其他门店缺货求助 · {board.length} 条</span>
        </div>
        {board.length === 0 ? (
          <div className="glass-flat rounded-2xl py-12 text-center">
            <p className="text-sm text-paper-500">暂无待认领的互调请求 🎐</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {board.map((req) => (
              <BoardCard key={req.id} req={req} />
            ))}
          </div>
        )}
      </section>

      {/* ── 我要备的货 ── */}
      {myClaims.length > 0 && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            <h2 className="text-sm font-semibold text-blue-800">我要备的货</h2>
            <span className="text-xs text-blue-600">你答应了给这些门店备货，别忘了留出来</span>
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
          <h2 className="text-[15px] font-semibold text-paper-900">我发出的互调</h2>
          <span className="text-xs text-paper-400">{myRequests.length} 条</span>
        </div>
        {myRequests.length === 0 ? (
          <div className="glass-flat rounded-2xl py-10 text-center">
            <p className="text-sm text-paper-500">你还没发起过互调请求</p>
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
  const [open, setOpen] = useState(false);
  const [itemText, setItemText] = useState("");
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
      const blob = await compressToJpeg(file);
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
      setError(err instanceof Error ? err.message : "图片上传失败");
    }
  }

  function reset() {
    setItemText("");
    setQuantity("");
    setNote("");
    setPhotoUrl(null);
    setUploadPhase("idle");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit() {
    if (!itemText.trim()) {
      setError("请填写要调的货");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createTransferRequest({
        itemText: itemText.trim(),
        photoUrl,
        quantity: quantity.trim() ? Number(quantity) : null,
        note: note.trim() || null,
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
        发起互调 · 问问哪家店有货
      </button>
    );
  }

  return (
    <div className="glass-strong rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-paper-900">发起互调请求</h2>
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="text-xs text-paper-400 hover:text-paper-700">
          取消
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-paper-600">要的货 *</label>
          <textarea
            value={itemText}
            onChange={(e) => setItemText(e.target.value)}
            rows={2}
            placeholder="例：iPhone 15 Pro 的某某款透明磨砂 funda，边框带 MagSafe 圈"
            className="w-full resize-none rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-sm text-paper-900 outline-none transition-colors placeholder:text-paper-400 focus:border-accent-500"
          />
        </div>

        <div className="flex gap-3">
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-paper-600">数量</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="可选"
              className="w-full rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-sm text-paper-900 outline-none transition-colors placeholder:text-paper-400 focus:border-accent-500"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-paper-600">备注</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="可选：客人在等、颜色可将就等"
              className="w-full rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-sm text-paper-900 outline-none transition-colors placeholder:text-paper-400 focus:border-accent-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-paper-600">照片（可选，帮别人认货）</label>
          <div className="flex items-center gap-3">
            {photoUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-paper-900/10" />
                <button
                  type="button"
                  onClick={() => { setPhotoUrl(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-paper-800 text-white"
                  aria-label="删除照片"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ) : (
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border border-dashed border-paper-300 text-paper-400 transition-colors hover:border-accent-500 hover:text-accent-500">
                {uploadPhase === "uploading" ? (
                  <span className="text-[10px]">上传中…</span>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
              </label>
            )}
            <p className="text-xs text-paper-400">拍一张或从相册选，会自动压缩。</p>
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          type="button"
          disabled={pending || uploadPhase === "uploading"}
          onClick={handleSubmit}
          className="w-full rounded-xl bg-accent-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
        >
          {pending ? "发送中…" : "广播给所有门店"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────── 看板卡片（可 ✓/✗）──────────────────────
function BoardCard({ req }: { req: TransferRequest }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="group glass-strong flex flex-col rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5">
      <div className="flex gap-3">
        <ItemThumb req={req} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-paper-900">{req.itemText}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-paper-400">
            <span className="text-paper-600">{req.requesterName ?? "某门店"}</span>
            {req.quantity ? <span>· 需 {req.quantity} 件</span> : null}
            <span>· {timeAgo(req.createdAt)}</span>
          </p>
          {req.note && <p className="mt-1 line-clamp-1 text-[11.5px] text-paper-500">📝 {req.note}</p>}
        </div>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

      {/* ✓ 我有 / ✗ 我没有 —— 悬停加强，触屏也可直接点 */}
      <div className="mt-3 flex gap-2 opacity-90 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => claimTransferRequest(req.id))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-mint-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          我有
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => declineTransferRequest(req.id))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-paper-200 bg-white/70 px-3 py-2 text-xs font-medium text-paper-500 transition-colors hover:border-paper-300 hover:text-paper-700 disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          我没有
        </button>
      </div>
    </div>
  );
}

// ────────────────────── 我要备的货 ──────────────────────
function ClaimRow({ req }: { req: TransferRequest }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(status: "done" | "open") {
    setError(null);
    startTransition(async () => {
      const res = await setTransferStatus(req.id, status);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/80 p-3 ring-1 ring-blue-100">
      <ItemThumb req={req} size="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-paper-900">{req.itemText}</p>
        <p className="mt-0.5 text-[11.5px] text-paper-500">
          给 <span className="font-medium text-paper-700">{req.requesterName ?? "某门店"}</span>
          {req.quantity ? ` · ${req.quantity} 件` : ""}
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
          退回
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => act("done")}
          className="inline-flex items-center gap-1 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-mint-600 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          {pending ? "…" : "已交货"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────── 我发出的互调 ──────────────────────
function MyRequestRow({ req }: { req: TransferRequest }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await setTransferStatus(req.id, "cancelled");
      if (res.error) setError(res.error);
    });
  }

  const dim = req.status === "done" || req.status === "cancelled";

  return (
    <div className={`flex items-center gap-3 rounded-xl p-3 ring-1 ring-paper-900/10 ${dim ? "bg-white/50" : "glass-flat"}`}>
      <ItemThumb req={req} size="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-paper-900">{req.itemText}</p>
          <StatusPill status={req.status} />
        </div>
        <p className="mt-0.5 text-[11.5px] text-paper-500">
          {req.status === "open" && "已广播，等门店认领…"}
          {req.status === "claimed" && (
            <>
              <span className="font-medium text-blue-700">{req.claimerName ?? "某门店"}</span> 有货，正在备货
            </>
          )}
          {req.status === "done" && (
            <>
              <span className="font-medium text-mint-600">{req.claimerName ?? "某门店"}</span> 已交货
            </>
          )}
          {req.status === "cancelled" && "已撤销"}
          {req.quantity ? ` · ${req.quantity} 件` : ""}
        </p>
        {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      </div>
      {(req.status === "open" || req.status === "claimed") && (
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="shrink-0 rounded-lg border border-paper-200 px-2.5 py-1.5 text-[11px] font-medium text-paper-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
        >
          {pending ? "…" : "撤销"}
        </button>
      )}
    </div>
  );
}
