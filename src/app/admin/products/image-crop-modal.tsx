"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────
// 拍照/选图后的裁剪弹层：拖拽移动、滑杆缩放、90° 旋转，square 输出。
// 手写实现（未引入第三方裁剪库），只做商品图需要的最小能力：
// 商品图在店铺页一律以 1:1 正方形 + object-cover 展示，这里让用户
// 自己决定正方形里露出哪一部分，而不是依赖浏览器自动裁切。
// ─────────────────────────────────────────────────────────────

const OUTPUT_SIZE = 1200;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export default function ImageCropModal({
  file,
  onCancel,
  onConfirm,
}: {
  file: File | Blob;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewSize, setViewSize] = useState(320);
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const dragRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    // 响应 file 变化去同步生成对应的 object URL，属于正当的外部资源同步
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewSize(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 旋转后图片的"有效宽高"（90°/270° 时长宽互换）
  const effSize = useMemo(() => {
    if (!natural) return null;
    const swapped = rotation % 180 !== 0;
    return { w: swapped ? natural.h : natural.w, h: swapped ? natural.w : natural.h };
  }, [natural, rotation]);

  // 铺满正方形取景框所需的基础缩放（cover），乘以用户缩放得到总缩放
  const baseScale = useMemo(() => {
    if (!effSize) return 1;
    return viewSize / Math.min(effSize.w, effSize.h);
  }, [effSize, viewSize]);

  const totalScale = baseScale * zoom;

  const maxOffset = useMemo(() => {
    if (!effSize) return { x: 0, y: 0 };
    const scaledW = effSize.w * totalScale;
    const scaledH = effSize.h * totalScale;
    return {
      x: Math.max(0, (scaledW - viewSize) / 2),
      y: Math.max(0, (scaledH - viewSize) / 2),
    };
  }, [effSize, totalScale, viewSize]);

  function clamp(off: { x: number; y: number }, max: { x: number; y: number }) {
    return {
      x: Math.min(max.x, Math.max(-max.x, off.x)),
      y: Math.min(max.y, Math.max(-max.y, off.y)),
    };
  }

  // 缩放变化时，把当前偏移重新夹到新的可移动范围内，避免缩小后露出取景框外的空白
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOffset((prev) => clamp(prev, maxOffset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxOffset.x, maxOffset.y]);

  function handlePointerDown(e: React.PointerEvent) {
    if (!natural) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffX: offset.x, startOffY: offset.y };
  }
  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const next = {
      x: drag.startOffX + (e.clientX - drag.startX),
      y: drag.startOffY + (e.clientY - drag.startY),
    };
    setOffset(clamp(next, maxOffset));
  }
  function handlePointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
  }

  function handleRotate() {
    setRotation((r) => (r + 90) % 360);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  async function handleConfirm() {
    const img = imgElRef.current;
    if (!img || !natural || !effSize) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 不可用");

      const k = OUTPUT_SIZE / viewSize;
      ctx.translate(OUTPUT_SIZE / 2 + offset.x * k, OUTPUT_SIZE / 2 + offset.y * k);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(totalScale * k, totalScale * k);
      ctx.drawImage(img, -natural.w / 2, -natural.h / 2, natural.w, natural.h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );
      if (!blob) throw new Error("裁剪失败");
      onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/90">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-white/90">调整图片</span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          aria-label="取消"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <div
          ref={viewportRef}
          className="relative mx-auto w-full max-w-[420px] touch-none overflow-hidden rounded-2xl bg-paper-900 select-none"
          style={{ aspectRatio: "1 / 1" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {objectUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgElRef}
              src={objectUrl}
              alt="待裁剪图片"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setNatural({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              style={
                natural
                  ? {
                      position: "absolute",
                      left: viewSize / 2,
                      top: viewSize / 2,
                      width: natural.w,
                      height: natural.h,
                      marginLeft: -natural.w / 2,
                      marginTop: -natural.h / 2,
                      maxWidth: "none",
                      transformOrigin: "center center",
                      transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${totalScale})`,
                    }
                  : { display: "none" }
              }
            />
          )}

          {/* 九宫格参考线 */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
            <div className="absolute top-1/3 left-0 w-full h-px bg-white/25" />
            <div className="absolute top-2/3 left-0 w-full h-px bg-white/25" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/40" />
          </div>
        </div>

        <div className="flex w-full max-w-[420px] items-center gap-3">
          <svg className="h-4 w-4 shrink-0 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="flex-1 accent-white"
            aria-label="缩放"
          />
          <button
            type="button"
            onClick={handleRotate}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label="旋转 90 度"
            title="旋转"
          >
            <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 px-6 py-5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || !natural}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-paper-900 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "处理中…" : "确定"}
        </button>
      </div>
    </div>
  );
}
