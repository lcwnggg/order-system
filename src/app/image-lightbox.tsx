"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import ModalPortal from "./modal-portal";

export type ZoomedImage = { urls: string[]; index: number; label: string };

/**
 * Visor de fotos a tamaño completo, compartido por todas las pantallas donde
 * aparecen productos (catálogo, listado del almacén, stock bajo, pedidos,
 * carrito, traspasos). Se usa con el hook `useImageLightbox`.
 *
 * Un producto puede tener varias fotos (dos modelos casi idénticos se
 * distinguen mirando la segunda), así que el visor es una galería: flechas,
 * teclado y arrastre con el dedo. Con una sola foto no se pinta ningún control
 * y se comporta igual que antes.
 */
export function ImageLightbox({
  image,
  onClose,
  onNavigate,
}: {
  image: ZoomedImage | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const t = useT();
  // En redes móviles la foto a tamaño completo puede tardar; sin esto la
  // pantalla se queda en negro sin ninguna señal y parece que se ha colgado.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Punto donde empezó el gesto, para pasar de foto arrastrando en el móvil.
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null);

  const total = image?.urls.length ?? 0;
  const url = image ? image.urls[image.index] : undefined;

  const go = useCallback(
    (delta: number) => {
      if (!image || total < 2) return;
      onNavigate((image.index + delta + total) % total);
    },
    [image, total, onNavigate]
  );

  useEffect(() => {
    if (!image) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image, onClose, go]);

  // Cada foto nueva empieza en estado "cargando" otra vez. Se ajusta durante
  // el render (no en un effect) para que el primer pintado ya salga limpio.
  const [trackedUrl, setTrackedUrl] = useState(url);
  if (url !== trackedUrl) {
    setTrackedUrl(url);
    setLoaded(false);
    setFailed(false);
  }

  if (!image || !url) return null;

  const arrowClass =
    "absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30";

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-black/85 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={image.label}
    >
      {!loaded && !failed && (
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-white/90"
          aria-hidden="true"
        />
      )}
      {failed && <p className="text-sm text-white/80">{t("common.imageLoadFailed")}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={image.label}
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        onTouchStart={(e) => setSwipeStartX(e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const endX = e.changedTouches[0]?.clientX;
          if (swipeStartX === null || endX === undefined) return;
          const dx = endX - swipeStartX;
          setSwipeStartX(null);
          // 60px: por debajo suele ser un toque tembloroso, no un arrastre.
          if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
        }}
        className={`max-h-[75vh] max-w-full rounded-2xl bg-white object-contain transition-opacity ${loaded ? "opacity-100" : "hidden opacity-0"}`}
      />

      {total > 1 && (
        <>
          <button
            type="button"
            aria-label={t("common.previousPhoto")}
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            className={`${arrowClass} left-3`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={t("common.nextPhoto")}
            onClick={(e) => { e.stopPropagation(); go(1); }}
            className={`${arrowClass} right-3`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {loaded && (
        <p className="max-w-full truncate text-sm font-medium text-white/90">
          {image.label}
          {total > 1 && (
            <span className="ml-2 font-mono text-xs text-white/60">{image.index + 1}/{total}</span>
          )}
        </p>
      )}

      {/* Miniaturas: con dos o tres fotos casi iguales, verlas juntas es la
          forma rápida de saber cuál se está mirando. */}
      {total > 1 && (
        <div className="flex max-w-full gap-2 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
          {image.urls.map((thumb, i) => (
            <button
              key={thumb}
              type="button"
              onClick={() => onNavigate(i)}
              aria-label={t("common.photoNumber", { n: i + 1 })}
              aria-current={i === image.index}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                i === image.index ? "ring-white" : "ring-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt="" className="h-full w-full bg-white object-cover" />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="rounded-lg bg-white/15 px-5 py-2 text-sm font-medium text-white hover:bg-white/25"
      >
        {t("common.close")}
      </button>
    </div>
    </ModalPortal>
  );
}

/**
 * Devuelve `open(fotos, etiqueta)` para abrir el visor y `node`, que hay que
 * pintar una sola vez en el componente (normalmente al final del JSX).
 *
 * `open` acepta una foto suelta o la galería entera; `startIndex` decide por
 * cuál se empieza.
 */
export function useImageLightbox() {
  const [image, setImage] = useState<ZoomedImage | null>(null);

  const open = useCallback(
    (urls: string | string[] | null | undefined, label: string, startIndex = 0) => {
      const list = (Array.isArray(urls) ? urls : [urls]).filter((u): u is string => !!u);
      if (list.length === 0) return;
      const index = Math.min(Math.max(startIndex, 0), list.length - 1);
      setImage({ urls: list, index, label });
    },
    []
  );
  const close = useCallback(() => setImage(null), []);
  const navigate = useCallback(
    (index: number) => setImage((prev) => (prev ? { ...prev, index } : prev)),
    []
  );

  return {
    image,
    open,
    close,
    node: <ImageLightbox image={image} onClose={close} onNavigate={navigate} />,
  };
}
