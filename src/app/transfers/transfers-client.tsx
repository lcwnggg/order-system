"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GroupStore, TransferRequest, TransferStatus } from "@/lib/transfers";
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
  stores,
  currentStoreId,
}: {
  requests: TransferRequest[];
  stores: GroupStore[];
  currentStoreId: string;
}) {
  useTransferRealtime();

  // 全部待认领的 open 请求（含自己发的），按门店归类画到「每家店一个圈」上
  const openReqs = useMemo(() => requests.filter((r) => r.status === "open"), [requests]);

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

      {/* ── 互调看板：每家店一个圈，缺货的店头上浮现气泡 ── */}
      <section>
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold text-paper-900">互调看板</h2>
          <span className="text-xs text-paper-400">
            {board.length > 0 ? `${board.length} 家店在找货，把鼠标滑到店头上的气泡` : "各门店缺货会浮现在这里"}
          </span>
        </div>
        <StoreRoster stores={stores} openReqs={openReqs} currentStoreId={currentStoreId} />
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

// ────────────────────── 每家店一个圈 + 头上浮气泡 ──────────────────────
function StoreRoster({
  stores,
  openReqs,
  currentStoreId,
}: {
  stores: GroupStore[];
  openReqs: TransferRequest[];
  currentStoreId: string;
}) {
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
        <p className="text-sm text-paper-500">还没有其他门店 🌱</p>
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
            isMe={store.id === currentStoreId}
          />
        ))}
      </div>
    </div>
  );
}

function StoreNode({ store, reqs, isMe }: { store: GroupStore; reqs: TransferRequest[]; isMe: boolean }) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const active = reqs.length > 0;
  const name = store.name ?? "某门店";
  // 自己的店不能认领自己的货；别家店可 ✓/✗
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
          aria-label={`${name} 在找货`}
        >
          <span className="animate-bubble-bob block">
            <span
              className={`relative block max-w-[120px] truncate rounded-2xl px-2.5 py-1 text-[11px] font-medium shadow-[0_10px_20px_-10px_rgba(46,52,84,.5)] ${
                isMe ? "bg-accent-500 text-white" : "bg-white text-paper-800 ring-1 ring-accent-200"
              }`}
            >
              {reqs.length > 1 ? `${reqs.length} 件求货` : reqs[0].itemText}
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

      {/* 门店小屋（tienda / videojuego 风） */}
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
        {isMe ? `${name}（你）` : name}
      </span>

      {/* 展开：该店所有待认领请求 + ✓/✗ */}
      {open && active && (
        <div className="absolute top-[92px] left-1/2 z-20 w-56 -translate-x-1/2 rounded-2xl glass-strong p-3 shadow-[0_20px_40px_-16px_rgba(46,52,84,.5)]">
          <p className="mb-2 text-[11px] font-medium text-paper-500">
            {isMe ? "你在找（可到下方撤销）" : `${name} 在找`}
          </p>
          <div className="space-y-2">
            {reqs.map((req) => (
              <div key={req.id} className="rounded-xl bg-white/70 p-2 ring-1 ring-paper-900/5">
                <div className="flex gap-2">
                  <ItemThumb req={req} size="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium text-paper-900">{req.itemText}</p>
                    <p className="mt-0.5 text-[10.5px] text-paper-400">
                      {req.quantity ? `需 ${req.quantity} 件 · ` : ""}
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
                      我有
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === req.id}
                      onClick={() => act(req.id, () => declineTransferRequest(req.id))}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-paper-200 bg-white/70 px-2 py-1.5 text-[11px] font-medium text-paper-500 transition-colors hover:text-paper-700 disabled:opacity-50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      我没有
                    </button>
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
