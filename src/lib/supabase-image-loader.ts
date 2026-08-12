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

/**
 * Misma idea, pero para los `<img>` sueltos: los del visor de fotos y los de
 * los formularios, que no pasan por `next/image` y hasta ahora se bajaban la
 * foto entera para pintarla en un recuadro de 40 px.
 *
 * Lo que no sea una foto pública de Storage (una previsualización `blob:` de
 * una foto recién hecha, una URL firmada) se devuelve tal cual: mejor sin
 * encoger que rota.
 */
export function supabaseImageUrl(src: string, width: number, quality = 75): string {
  if (!src.includes(PUBLIC_OBJECT)) return src;

  const url = new URL(src.replace(PUBLIC_OBJECT, PUBLIC_RENDER));
  url.searchParams.set("width", String(Math.min(width, MAX_WIDTH)));
  url.searchParams.set("quality", String(quality));
  // `contain` respeta la proporción; el encuadre cuadrado ya se decidió al
  // recortar la foto en la subida.
  url.searchParams.set("resize", "contain");
  return url.href;
}

export default function supabaseImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  return supabaseImageUrl(src, width, quality ?? 75);
}
