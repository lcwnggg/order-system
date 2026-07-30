"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";

export type ZoomedImage = { url: string; label: string };

/**
 * Visor de fotos a tamaño completo, compartido por todas las pantallas donde
 * aparecen productos (catálogo, listado del almacén, stock bajo, pedidos,
 * carrito, traspasos). Se usa con el hook `useImageLightbox`.
 */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: ZoomedImage | null;
  onClose: () => void;
}) {
  const t = useT();
  // En redes móviles la foto a tamaño completo puede tardar; sin esto la
  // pantalla se queda en negro sin ninguna señal y parece que se ha colgado.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!image) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [image, onClose]);

  // Cada foto nueva empieza en estado "cargando" otra vez. Se ajusta durante
  // el render (no en un effect) para que el primer pintado ya salga limpio.
  const [trackedUrl, setTrackedUrl] = useState(image?.url);
  if (image?.url !== trackedUrl) {
    setTrackedUrl(image?.url);
    setLoaded(false);
    setFailed(false);
  }

  if (!image) return null;

  return (
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
        src={image.url}
        alt={image.label}
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`max-h-[75vh] max-w-full rounded-2xl bg-white object-contain transition-opacity ${loaded ? "opacity-100" : "hidden opacity-0"}`}
      />
      {loaded && <p className="max-w-full truncate text-sm font-medium text-white/90">{image.label}</p>}
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg bg-white/15 px-5 py-2 text-sm font-medium text-white hover:bg-white/25"
      >
        {t("common.close")}
      </button>
    </div>
  );
}

/**
 * Devuelve `open(url, etiqueta)` para abrir la foto y `node`, que hay que
 * pintar una sola vez en el componente (normalmente al final del JSX).
 */
export function useImageLightbox() {
  const [image, setImage] = useState<ZoomedImage | null>(null);

  const open = useCallback((url: string | null | undefined, label: string) => {
    if (url) setImage({ url, label });
  }, []);
  const close = useCallback(() => setImage(null), []);

  return {
    image,
    open,
    close,
    node: <ImageLightbox image={image} onClose={close} />,
  };
}
