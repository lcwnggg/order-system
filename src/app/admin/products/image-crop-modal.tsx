"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────────────────────
// Recorte de la foto del producto.
//
// La foto se ve ENTERA (nunca recortada de oficio) y encima hay un
// rectángulo que se arrastra por las esquinas o los lados, con la
// proporción que se quiera. Lo que quede fuera se tira; lo que falte
// para completar el cuadrado final se rellena de BLANCO.
//
// Blanco y no transparente a propósito: la salida es JPEG y ahí lo
// transparente se vuelve negro, así que una foto de producto acabaría
// con marco negro en la tienda.
// ─────────────────────────────────────────────────────────────

/** Lado del cuadrado que se entrega, en px. */
const OUTPUT_SIZE = 1200;
/**
 * Lado máximo al que se rasteriza la foto para exportar. Una foto de móvil de
 * 12 MP son ~48 MB por copia en memoria: en un iPhone eso es quedarse sin
 * memoria a mitad del recorte. Como la salida es de 1200 px, 2400 sobra.
 */
const WORK_MAX = 2400;
/** Lado mínimo del recorte, en px de pantalla (para que no se pueda anular). */
const MIN_CROP_PX = 44;
/**
 * Margen entre la foto y el borde del escenario. Los tiradores van centrados
 * en la esquina, así que la mitad de cada uno cae fuera de la foto: sin este
 * margen, en un móvil los de la izquierda y la derecha quedan medio fuera de
 * la pantalla y no hay forma de agarrarlos con el dedo.
 */
const STAGE_INSET = 26;

/** Rectángulo de recorte en coordenadas normalizadas (0..1) de la imagen ya girada. */
type Crop = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragKind = Handle | "move";

const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export default function ImageCropModal({
  file,
  onCancel,
  onConfirm,
}: {
  file: File | Blob;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [crop, setCrop] = useState<Crop>(FULL_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragRef = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    start: Crop;
    boxW: number;
    boxH: number;
  } | null>(null);

  // Object URL de la foto. Se revoca al cambiar de archivo o al cerrar.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    // Sincronizar un recurso externo (object URL) con la prop `file` es
    // justamente para lo que sirve un efecto.
    /* eslint-disable react-hooks/set-state-in-effect */
    setUrl(objectUrl);
    setNatural(null);
    setRotation(0);
    setCrop(FULL_CROP);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // Mientras el editor está abierto, la página de detrás no se mueve. Sin esto,
  // en el móvil un arrastre que empiece un pelín fuera de la foto desplaza el
  // formulario (o dispara el "recargar tirando hacia abajo") en vez de recortar.
  useEffect(() => {
    const { overflow, overscrollBehavior } = document.body.style;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.overscrollBehavior = overscrollBehavior;
    };
  }, []);

  // Tamaño del escenario donde se pinta la foto.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // Solo medidas positivas: antes del primer layout clientWidth puede ser 0 y
    // con 0 los factores de escala se van a Infinity → canvas en NaN → JPEG
    // completamente negro, y sin lanzar ningún error.
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setStage({ w, h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Medidas de la foto tras girar (a 90°/270° se intercambian ancho y alto).
  const eff = useMemo(() => {
    if (!natural) return null;
    const swapped = rotation % 180 !== 0;
    return { w: swapped ? natural.h : natural.w, h: swapped ? natural.w : natural.h };
  }, [natural, rotation]);

  // Caja donde se ve la foto entera dentro del escenario (contain, centrada).
  const box = useMemo(() => {
    if (!eff || stage.w <= 0 || stage.h <= 0) return null;
    const availW = Math.max(1, stage.w - STAGE_INSET * 2);
    const availH = Math.max(1, stage.h - STAGE_INSET * 2);
    const scale = Math.min(availW / eff.w, availH / eff.h);
    const w = eff.w * scale;
    const h = eff.h * scale;
    return { left: (stage.w - w) / 2, top: (stage.h - h) / 2, w, h };
  }, [eff, stage]);

  const ready = box !== null && natural !== null && !error;

  // ── arrastre: mover el rectángulo o tirar de un tirador ──

  const startDrag = useCallback(
    (kind: DragKind) => (e: React.PointerEvent) => {
      if (!box || busy) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* el puntero puede haberse soltado ya; capturarlo es una mejora, no un requisito */
      }
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        start: crop,
        boxW: box.w,
        boxH: box.h,
      };
    },
    [box, busy, crop]
  );

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { kind, start, boxW, boxH } = drag;
    const dx = (e.clientX - drag.startX) / boxW;
    const dy = (e.clientY - drag.startY) / boxH;
    // El mínimo se fija en px de pantalla y se pasa a proporción; el tope de
    // 0.5 evita que en una caja diminuta el mínimo sea mayor que la foto.
    const minW = Math.min(0.5, MIN_CROP_PX / boxW);
    const minH = Math.min(0.5, MIN_CROP_PX / boxH);

    if (kind === "move") {
      setCrop({
        ...start,
        x: clamp(start.x + dx, 0, 1 - start.w),
        y: clamp(start.y + dy, 0, 1 - start.h),
      });
      return;
    }

    let { x, y, w, h } = start;
    if (kind.includes("w")) {
      const nx = clamp(start.x + dx, 0, start.x + start.w - minW);
      w = start.x + start.w - nx;
      x = nx;
    }
    if (kind.includes("e")) {
      w = clamp(start.w + dx, minW, 1 - start.x);
    }
    if (kind.includes("n")) {
      const ny = clamp(start.y + dy, 0, start.y + start.h - minH);
      h = start.y + start.h - ny;
      y = ny;
    }
    if (kind.includes("s")) {
      h = clamp(start.h + dy, minH, 1 - start.y);
    }
    setCrop({ x, y, w, h });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* el puntero ya se había liberado */
    }
  }, []);

  const dragHandlers = (kind: DragKind) => ({
    onPointerDown: startDrag(kind),
    onPointerMove: onDragMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  function handleRotate() {
    // Se gira también el recorte para no perder lo que ya haya elegido:
    // al girar 90° en sentido horario, (x,y) pasa a (1−y, x).
    setCrop((c) => ({ x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w }));
    setRotation((r) => (r + 90) % 360);
  }

  // ── exportar ──

  async function handleConfirm() {
    const img = imgElRef.current;
    if (!img || !natural || !eff || busy) return;
    setBusy(true);
    setError(null);
    try {
      // 1. la foto, girada y con el lado máximo acotado
      const scale = Math.min(1, WORK_MAX / Math.max(natural.w, natural.h));
      const w = Math.max(1, Math.round(natural.w * scale));
      const h = Math.max(1, Math.round(natural.h * scale));
      const swapped = rotation % 180 !== 0;
      const rotW = swapped ? h : w;
      const rotH = swapped ? w : h;

      const rotated = document.createElement("canvas");
      rotated.width = rotW;
      rotated.height = rotH;
      const rctx = rotated.getContext("2d");
      if (!rctx) throw new Error(t("common.canvasUnavailable"));
      rctx.imageSmoothingQuality = "high";
      rctx.translate(rotW / 2, rotH / 2);
      rctx.rotate((rotation * Math.PI) / 180);
      rctx.drawImage(img, -w / 2, -h / 2, w, h);

      // 2. el trozo elegido, en píxeles de esa foto girada
      const sx = clamp(Math.round(crop.x * rotW), 0, rotW - 1);
      const sy = clamp(Math.round(crop.y * rotH), 0, rotH - 1);
      const sw = clamp(Math.round(crop.w * rotW), 1, rotW - sx);
      const sh = clamp(Math.round(crop.h * rotH), 1, rotH - sy);

      // 3. centrado dentro del cuadrado, sin deformarlo y sin recortar más:
      //    el hueco que sobra a los lados (o arriba y abajo) queda blanco.
      const k = Math.min(OUTPUT_SIZE / sw, OUTPUT_SIZE / sh);
      if (!Number.isFinite(k) || k <= 0) throw new Error(t("crop.failed"));
      const dw = sw * k;
      const dh = sh * k;

      const out = document.createElement("canvas");
      out.width = OUTPUT_SIZE;
      out.height = OUTPUT_SIZE;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error(t("common.canvasUnavailable"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(rotated, sx, sy, sw, sh, (OUTPUT_SIZE - dw) / 2, (OUTPUT_SIZE - dh) / 2, dw, dh);

      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error(t("crop.failed"));
      onConfirm(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("crop.failed"));
    } finally {
      setBusy(false);
    }
  }

  // ── pintado ──

  // Rectángulo de recorte en px del escenario.
  const rect = box
    ? {
        left: box.left + crop.x * box.w,
        top: box.top + crop.y * box.h,
        width: crop.w * box.w,
        height: crop.h * box.h,
      }
    : null;

  const handleStyle: Record<Handle, string> = {
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    ne: "left-full top-0 -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    e: "left-full top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    se: "left-full top-full -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
    s: "left-1/2 top-full -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    sw: "left-0 top-full -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  };
  /** Los tiradores de esquina se ven como una escuadra; los de lado, como una barra. */
  const handleInner: Record<Handle, string> = {
    nw: "h-5 w-5 border-l-[3px] border-t-[3px] rounded-tl-sm",
    ne: "h-5 w-5 border-r-[3px] border-t-[3px] rounded-tr-sm",
    se: "h-5 w-5 border-r-[3px] border-b-[3px] rounded-br-sm",
    sw: "h-5 w-5 border-l-[3px] border-b-[3px] rounded-bl-sm",
    n: "h-[3px] w-7 rounded-full bg-white border-0",
    s: "h-[3px] w-7 rounded-full bg-white border-0",
    e: "h-7 w-[3px] rounded-full bg-white border-0",
    w: "h-7 w-[3px] rounded-full bg-white border-0",
  };

  return (
    // Altura en `dvh` y no `inset-0`: en el navegador del móvil, con las barras
    // a la vista, el 100 % de toda la vida es MÁS ALTO que lo que se ve, así que
    // los botones de abajo acababan tapados por la barra de Safari — y como la
    // capa es fija, tampoco se podía desplazar para llegar a ellos.
    <div
      className="fixed inset-x-0 top-0 z-[70] flex h-[100dvh] touch-none flex-col overscroll-none bg-black/95"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-2">
        <span className="text-[13px] font-medium text-white/90">{t("crop.title")}</span>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          aria-label={t("common.cancel")}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Escenario: la foto entera + el rectángulo de recorte encima */}
      <div ref={stageRef} className="relative min-h-0 flex-1 touch-none overflow-hidden select-none">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            ref={imgElRef}
            src={url}
            alt={t("crop.imageAlt")}
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                setNatural({ w: el.naturalWidth, h: el.naturalHeight });
              } else {
                setError(t("crop.loadFailed"));
              }
            }}
            onError={() => setError(t("crop.loadFailed"))}
            style={
              box && eff
                ? {
                    position: "absolute",
                    left: box.left + box.w / 2,
                    top: box.top + box.h / 2,
                    // El <img> conserva su orientación original; al girarlo 90°
                    // ocupa la caja con el ancho y el alto intercambiados.
                    width: rotation % 180 === 0 ? box.w : box.h,
                    height: rotation % 180 === 0 ? box.h : box.w,
                    maxWidth: "none",
                    transformOrigin: "center center",
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                  }
                : { visibility: "hidden", position: "absolute" }
            }
          />
        )}

        {ready && rect && (
          <>
            {/* Oscurecido de todo lo que queda fuera del recorte */}
            <div
              className="pointer-events-none absolute"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              }}
            />
            {/* Marco arrastrable + tiradores */}
            <div
              className="absolute cursor-move touch-none"
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              {...dragHandlers("move")}
            >
              <div className="pointer-events-none absolute inset-0 border border-white/90" />
              {/* Guías de tercios */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
                <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
                <div className="absolute top-1/3 left-0 h-px w-full bg-white/25" />
                <div className="absolute top-2/3 left-0 h-px w-full bg-white/25" />
              </div>
              {HANDLES.map((hd) => (
                <div
                  key={hd}
                  // La zona sensible (44 px) es bastante mayor que el dibujo:
                  // con el dedo hay que poder agarrar la esquina sin puntería.
                  className={`absolute flex h-11 w-11 items-center justify-center touch-none ${handleStyle[hd]}`}
                  {...dragHandlers(hd)}
                >
                  <span className={`block border-white ${handleInner[hd]}`} />
                </div>
              ))}
            </div>
          </>
        )}

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-white/70">
            {error ?? t("common.processing")}
          </div>
        )}
      </div>

      {/* Barra única: girar / toda la foto a un lado, cancelar / aceptar al otro.
          Todo en una fila para dejarle a la foto el máximo de alto posible. */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        <p className="mb-2 text-center text-[11px] leading-snug text-white/55">{t("crop.hint")}</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleRotate}
            disabled={!ready || busy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/25 disabled:opacity-40"
            aria-label={t("crop.rotate90")}
            title={t("crop.rotate90")}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setCrop(FULL_CROP)}
            disabled={!ready || busy}
            className="h-10 shrink-0 rounded-lg bg-white/15 px-3 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-40"
          >
            {t("crop.selectAll")}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-lg bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/20"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !ready}
            className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-paper-900 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("common.processing") : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
