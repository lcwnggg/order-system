"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  canvasToBlob,
  cutOutPolygon,
  detectSubject,
  warpQuad,
  whitenBackground,
  type Point,
} from "@/lib/image-scan";

// ─────────────────────────────────────────────────────────────
// Editor de la foto del producto. Tres herramientas encadenables:
//
//   · Encuadrar  → mover/zoom/girar dentro del cuadrado (lo de siempre)
//   · Auto       → detecta el producto y lo recorta enderezado, como el
//                  escáner de documentos de iOS (ver src/lib/image-scan.ts)
//   · Libre      → se dibuja la silueta a dedo y el resto queda en blanco
//
// "Encadenables" es literal: cada operación produce una imagen nueva que
// se apila sobre la anterior, así que se puede escanear, luego quitar el
// fondo y luego encuadrar. `Deshacer` retrocede una capa.
//
// La salida es siempre un cuadrado de 1200 px sobre fondo BLANCO (no
// transparente: al pasar a JPEG lo transparente se vuelve negro, y una
// foto de producto con marco negro queda fatal en la tienda).
// ─────────────────────────────────────────────────────────────

const OUTPUT_SIZE = 1200;
const MAX_ZOOM = 3;
/** Distancia mínima entre puntos del trazo libre, en px de pantalla. */
const LASSO_MIN_STEP = 4;

type Mode = "frame" | "lasso";
type Natural = { url: string; w: number; h: number };

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement>(null);

  // Pila de capas: [0] es el original; cada herramienta apila un resultado.
  const [layers, setLayers] = useState<string[]>([]);
  // Todas las object URL creadas aquí, para revocarlas de golpe al cerrar.
  const createdUrls = useRef<string[]>([]);

  const [natural, setNatural] = useState<Natural | null>(null);
  const [viewSize, setViewSize] = useState(320);
  const [mode, setMode] = useState<Mode>("frame");
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [lasso, setLasso] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const dragRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);
  const drawingRef = useRef(false);

  const currentUrl = layers[layers.length - 1] ?? null;
  // `natural` se rellena en el onLoad del <img>; hasta que corresponda a la
  // capa actual no se puede calcular nada (si no, se usan las medidas de la
  // capa anterior y sale un encuadre desplazado durante un frame).
  const ready = natural !== null && natural.url === currentUrl;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    createdUrls.current = [url];
    // Sincronizar recursos externos (object URL) con la prop `file` es
    // justamente para lo que sirve un efecto.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLayers([url]);
    setNatural(null);
    setRotation(0);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLasso([]);
    setStatus(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      for (const u of createdUrls.current) URL.revokeObjectURL(u);
      createdUrls.current = [];
    };
  }, [file]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Solo anchuras positivas: antes del primer layout clientWidth puede ser 0,
    // y con 0 el factor de exportación se va a Infinity → canvas en NaN →
    // JPEG completamente negro, sin lanzar ningún error.
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setViewSize(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Medidas efectivas tras girar (a 90°/270° se intercambian ancho y alto)
  const effSize = useMemo(() => {
    if (!ready) return null;
    const swapped = rotation % 180 !== 0;
    return { w: swapped ? natural.h : natural.w, h: swapped ? natural.w : natural.h };
  }, [ready, natural, rotation]);

  // zoom = 1 llena el cuadrado (cover). El mínimo del slider es el zoom que
  // hace caber la imagen entera (contain), útil después de un recorte
  // automático: se ve el producto completo con márgenes blancos.
  const coverScale = effSize ? viewSize / Math.min(effSize.w, effSize.h) : 1;
  const containZoom = effSize ? Math.min(effSize.w, effSize.h) / Math.max(effSize.w, effSize.h) : 1;
  const totalScale = coverScale * zoom;

  const maxOffset = useMemo(() => {
    if (!effSize) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (effSize.w * totalScale - viewSize) / 2),
      y: Math.max(0, (effSize.h * totalScale - viewSize) / 2),
    };
  }, [effSize, totalScale, viewSize]);

  const clamp = useCallback(
    (off: { x: number; y: number }, max: { x: number; y: number }) => ({
      x: Math.min(max.x, Math.max(-max.x, off.x)),
      y: Math.min(max.y, Math.max(-max.y, off.y)),
    }),
    []
  );

  // Al cambiar el zoom hay que volver a encajar el desplazamiento en el nuevo
  // margen; si no, al alejar quedarían huecos fuera del encuadre.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOffset((prev) => clamp(prev, maxOffset));
  }, [maxOffset, clamp]);

  // ── conversión pantalla → píxeles de la imagen ──
  // Inversa exacta del transform CSS: translate(offset) rotate(θ) scale(k)
  // aplicado a un elemento centrado en el visor.
  const viewToImage = useCallback(
    (vx: number, vy: number): Point => {
      if (!natural) return { x: 0, y: 0 };
      const dx = (vx - (viewSize / 2 + offset.x)) / totalScale;
      const dy = (vy - (viewSize / 2 + offset.y)) / totalScale;
      const rad = (-rotation * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      return {
        x: dx * c - dy * s + natural.w / 2,
        y: dx * s + dy * c + natural.h / 2,
      };
    },
    [natural, viewSize, offset.x, offset.y, totalScale, rotation]
  );

  // ── pila de capas ──

  function resetTransform(fit: boolean) {
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setZoom(fit ? 0 : 1); // 0 = «ajústalo al cargar» (se corrige en onLoad)
    setLasso([]);
  }

  const pushCanvas = useCallback(async (canvas: HTMLCanvasElement) => {
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    createdUrls.current.push(url);
    setLayers((prev) => [...prev, url]);
  }, []);

  function handleUndo() {
    if (layers.length <= 1) return;
    // No se revoca la URL descartada: React aún puede tener el <img> viejo en
    // el árbol durante el commit y quedaría una imagen rota. Se revocan todas
    // juntas al desmontar.
    setLayers((prev) => prev.slice(0, -1));
    setNatural(null);
    resetTransform(false);
    setStatus(null);
  }

  // ── herramientas ──

  /**
   * Cede el hilo un momento para que se pinte el estado "ocupado" antes de
   * bloquearlo con el análisis.
   *
   * A propósito con setTimeout y NO con requestAnimationFrame: si la usuaria
   * se cambia de pestaña justo al pulsar, rAF deja de dispararse y el editor
   * se queda en «Detectando…» para siempre, con el botón de aceptar
   * deshabilitado y sin forma de salir salvo cerrar.
   */
  function yieldToPaint(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 32));
  }

  async function handleAuto() {
    const img = imgElRef.current;
    if (!img || !ready) return;
    setBusy(true);
    setStatus(t("crop.detecting"));
    try {
      await yieldToPaint();
      const detection = detectSubject(img, natural.w, natural.h);
      if (!detection) {
        setStatus(t("crop.autoNotFound"));
        return;
      }
      const warped = warpQuad(img, natural.w, natural.h, detection.quad);
      if (!warped) {
        setStatus(t("crop.autoNotFound"));
        return;
      }
      await pushCanvas(warped);
      resetTransform(true);
      setStatus(
        detection.kind === "document" ? t("crop.autoDoneDocument") : t("crop.autoDoneObject")
      );
    } catch {
      setStatus(t("crop.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveBackground() {
    const img = imgElRef.current;
    if (!img || !ready) return;
    setBusy(true);
    setStatus(t("crop.detecting"));
    try {
      await yieldToPaint();
      const detection = detectSubject(img, natural.w, natural.h);
      if (!detection) {
        setStatus(t("crop.autoNotFound"));
        return;
      }
      await pushCanvas(whitenBackground(img, natural.w, natural.h, detection));
      resetTransform(false);
      setStatus(t("crop.bgRemoved"));
    } catch {
      setStatus(t("crop.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyLasso() {
    const img = imgElRef.current;
    if (!img || !ready || lasso.length < 3) return;
    setBusy(true);
    setStatus(null);
    try {
      await yieldToPaint();
      const points = lasso.map((p) => viewToImage(p.x, p.y));
      const cut = cutOutPolygon(img, natural.w, natural.h, points);
      if (!cut) {
        setStatus(t("crop.lassoTooSmall"));
        return;
      }
      await pushCanvas(cut);
      resetTransform(true);
      setMode("frame");
      setStatus(t("crop.lassoDone"));
    } catch {
      setStatus(t("crop.failed"));
    } finally {
      setBusy(false);
    }
  }

  // ── puntero: arrastrar (encuadre) o dibujar (libre) ──

  function handlePointerDown(e: React.PointerEvent) {
    if (!ready || busy) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* el puntero puede haberse soltado ya; capturarlo es una mejora, no un requisito */
    }
    if (mode === "lasso") {
      drawingRef.current = true;
      const rect = e.currentTarget.getBoundingClientRect();
      setLasso([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      return;
    }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: offset.x,
      startOffY: offset.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (mode === "lasso") {
      if (!drawingRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setLasso((prev) => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < LASSO_MIN_STEP) return prev;
        return [...prev, p];
      });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(
      clamp(
        {
          x: drag.startOffX + (e.clientX - drag.startX),
          y: drag.startOffY + (e.clientY - drag.startY),
        },
        maxOffset
      )
    );
  }

  function handlePointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    drawingRef.current = false;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* el puntero ya se había liberado */
    }
  }

  function handleRotate() {
    setRotation((r) => (r + 90) % 360);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setLasso([]);
  }

  // ── exportar ──

  async function handleConfirm() {
    const img = imgElRef.current;
    if (!img || !ready || !effSize) return;
    // El preview se dibuja con `viewSize`; exportar con ese mismo número es lo
    // que garantiza que lo que se ve es lo que sale.
    const basis = viewSize > 0 ? viewSize : viewportRef.current?.clientWidth ?? 0;
    const k = OUTPUT_SIZE / basis;
    const scale = totalScale * k;
    // Cualquier 0 / NaN / Infinity aquí hace que el canvas no pinte nada y se
    // exporte una imagen en negro sin dar error. Mejor abortar.
    if (!Number.isFinite(k) || !Number.isFinite(scale) || scale <= 0) return;

    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(t("common.canvasUnavailable"));

      // Fondo blanco primero: si la imagen no llena el cuadrado (zoom alejado,
      // o recorte libre), el hueco queda blanco en vez de negro.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      ctx.translate(OUTPUT_SIZE / 2 + offset.x * k, OUTPUT_SIZE / 2 + offset.y * k);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -natural.w / 2, -natural.h / 2, natural.w, natural.h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );
      if (!blob) throw new Error(t("crop.failed"));
      onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }

  const lassoPath =
    lasso.length > 1 ? lasso.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/90">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-white/90">{t("crop.title")}</span>
        <div className="flex items-center gap-2">
          {layers.length > 1 && (
            <button
              type="button"
              onClick={handleUndo}
              disabled={busy}
              className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-40"
            >
              {t("crop.undo")}
            </button>
          )}
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
      </div>

      {/* Selector de herramienta */}
      <div className="flex shrink-0 justify-center px-4 pb-3">
        <div className="flex gap-1 rounded-xl bg-white/10 p-1">
          {(["frame", "lasso"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setLasso([]);
                setStatus(m === "lasso" ? t("crop.lassoHint") : null);
              }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                mode === m ? "bg-white text-paper-900" : "text-white/80 hover:text-white"
              }`}
            >
              {m === "frame" ? t("crop.modeFrame") : t("crop.modeLasso")}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <div
          ref={viewportRef}
          className={`relative mx-auto w-full max-w-[420px] touch-none overflow-hidden rounded-2xl bg-white select-none ${
            mode === "lasso" ? "cursor-crosshair" : "cursor-move"
          }`}
          style={{ aspectRatio: "1 / 1" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {currentUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={currentUrl}
              ref={imgElRef}
              src={currentUrl}
              alt={t("crop.imageAlt")}
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setNatural({ url: currentUrl, w: el.naturalWidth, h: el.naturalHeight });
                // zoom 0 es la señal de «encájalo entero» que deja resetTransform(true)
                setZoom((z) =>
                  z === 0
                    ? Math.min(el.naturalWidth, el.naturalHeight) /
                      Math.max(el.naturalWidth, el.naturalHeight)
                    : z
                );
              }}
              style={
                ready
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

          {/* Trazo del recorte libre */}
          {mode === "lasso" && lassoPath && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${viewSize} ${viewSize}`}
            >
              <polygon
                points={lassoPath}
                fill="rgba(59,130,246,0.18)"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </svg>
          )}

          {/* Guías (solo estorban mientras se dibuja a mano) */}
          {mode === "frame" && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/3 top-0 h-full w-px bg-black/10" />
              <div className="absolute left-2/3 top-0 h-full w-px bg-black/10" />
              <div className="absolute top-1/3 left-0 w-full h-px bg-black/10" />
              <div className="absolute top-2/3 left-0 w-full h-px bg-black/10" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/40" />
        </div>

        {status && (
          <p className="min-h-[1rem] text-center text-xs text-white/70">{status}</p>
        )}

        {/* Acciones automáticas */}
        <div className="flex w-full max-w-[420px] flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={handleAuto}
            disabled={busy || !ready}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 8V6a2 2 0 012-2h2M4 16v2a2 2 0 002 2h2m8-16h2a2 2 0 012 2v2m-4 12h2a2 2 0 002-2v-2" />
            </svg>
            {t("crop.auto")}
          </button>
          <button
            type="button"
            onClick={handleRemoveBackground}
            disabled={busy || !ready}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4h16v16H4z M9 9h6v6H9z" />
            </svg>
            {t("crop.removeBg")}
          </button>
          {mode === "lasso" && (
            <>
              <button
                type="button"
                onClick={handleApplyLasso}
                disabled={busy || lasso.length < 3}
                className="rounded-lg bg-blue-500 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
              >
                {t("crop.applyLasso")}
              </button>
              <button
                type="button"
                onClick={() => setLasso([])}
                disabled={busy || lasso.length === 0}
                className="rounded-lg bg-white/15 px-3.5 py-2 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-40"
              >
                {t("crop.clearLasso")}
              </button>
            </>
          )}
        </div>

        {/* Zoom + giro (solo tienen sentido encuadrando) */}
        {mode === "frame" && (
          <div className="flex w-full max-w-[420px] items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              type="range"
              min={containZoom}
              max={MAX_ZOOM}
              step={0.01}
              value={Math.max(containZoom, Math.min(MAX_ZOOM, zoom))}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-white"
              aria-label={t("crop.zoom")}
            />
            <button
              type="button"
              onClick={() => setZoom(containZoom)}
              className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-white/25"
            >
              {t("crop.fit")}
            </button>
            <button
              type="button"
              onClick={handleRotate}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
              aria-label={t("crop.rotate90")}
              title={t("crop.rotate")}
            >
              <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 px-6 py-5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || !ready}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-paper-900 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? t("common.processing") : t("common.confirm")}
        </button>
      </div>
    </div>
  );
}
