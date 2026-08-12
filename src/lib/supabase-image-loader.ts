"use client";

/**
 * Redimensionado de fotos: lo hace Supabase, no Vercel.
 *
 * Por defecto `next/image` pasa por `/_next/image`, el optimizador de Vercel,
 * que tiene una cuota mensual. Al agotarse devuelve 402 y TODAS las miniaturas
 * salen rotas de golpe (las fotos abiertas con la lupa seguían viéndose porque
 * son un `<img>` normal que no pasa por ahí). Como las fotos ya viven en
 * Supabase Storage, se le pide a él la versión pequeña y el problema desaparece
 * de raíz: sin cuota que agotar y sin bajar 300 KB para un recuadro de 40 px.
 *
 * El truco es solo cambiar el tramo `object` por `render/image` en la URL
 * pública; el resto de la ruta es idéntica.
 */

const PUBLIC_OBJECT = "/storage/v1/object/public/";
const PUBLIC_RENDER = "/storage/v1/render/image/public/";

/** Tope de Supabase: por encima devuelve error en vez de la foto. */
const MAX_WIDTH = 2500;

export default function supabaseImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  // Cualquier cosa que no sea una foto pública de Storage (un `/public`, una
  // URL firmada) se sirve tal cual: mejor sin encoger que rota.
  if (!src.includes(PUBLIC_OBJECT)) return src;

  const url = new URL(src.replace(PUBLIC_OBJECT, PUBLIC_RENDER));
  url.searchParams.set("width", String(Math.min(width, MAX_WIDTH)));
  url.searchParams.set("quality", String(quality ?? 75));
  // `contain` respeta la proporción; el encuadre cuadrado ya se decidió al
  // recortar la foto en la subida.
  url.searchParams.set("resize", "contain");
  return url.href;
}
