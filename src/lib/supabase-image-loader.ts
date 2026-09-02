"use client";

/**
 * Las fotos se sirven tal cual desde Supabase Storage: ningún servicio las
 * encoge en el momento de pedirlas.
 *
 * Esto no es una preferencia, es la cicatriz de haberse quedado sin fotos dos
 * veces por lo mismo:
 *
 *  1. Por defecto `next/image` pasa por `/_next/image`, el optimizador de
 *     Vercel, que tiene cuota mensual. Al agotarse devolvió
 *     `402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` y todas las miniaturas
 *     salieron rotas a la vez.
 *  2. El apaño fue pedírselas a Supabase (`/storage/v1/render/image/`), pero
 *     ese endpoint es de pago: en cuanto el proyecto dejó de tenerlo empezó a
 *     devolver `403 FeatureNotEnabled` y otra vez sin fotos.
 *
 * La moraleja es que cualquier servicio que redimensione AL SERVIR es un
 * interruptor que no controlamos y que apaga todas las imágenes de golpe. Así
 * que las miniaturas se generan al subir la foto (ver `image-upload.ts`) y se
 * guardan como ficheros normales al lado del original:
 *
 *     1788281829441-amzjso7av9d.jpg           ← original (1200 px)
 *     1788281829441-amzjso7av9d.jpg.w400.jpg  ← miniatura de listas
 *     1788281829441-amzjso7av9d.jpg.w800.jpg  ← tamaño intermedio
 *
 * Servirlas es descargar un fichero público: no hay cuota que agotar, ni plan
 * que contratar, ni función que activar. Y si alguna falta (fotos subidas
 * antes de esto, o un borrado a mano), `ImageFallback` la sustituye por el
 * original, así que nunca se ve un hueco.
 */

const PUBLIC_OBJECT = "/storage/v1/object/public/";

/**
 * Tamaños que se guardan de cada foto. Se pide siempre el más pequeño que
 * cubra el hueco; por encima del mayor se sirve el original (1200 px, que es
 * a lo que se suben).
 *
 * Al tocar esta lista hay que regenerar las miniaturas en
 * `/admin/products/thumbnails`; mientras tanto las que falten caen al
 * original, que es feo de peso pero no se ve roto.
 */
export const THUMB_WIDTHS = [400, 800] as const;

/** `foto.jpg.w400.jpg` → sí; `foto.jpg` → no. */
const VARIANT_SUFFIX = /\.w\d+\.jpg$/;

/** El nombre del fichero de una miniatura, a partir del del original. */
export function thumbName(fileName: string, width: number): string {
  return `${fileName}.w${width}.jpg`;
}

/** ¿Es el nombre de una miniatura generada por nosotros? */
export function isThumbName(fileName: string): boolean {
  return VARIANT_SUFFIX.test(fileName);
}

/**
 * El original del que salió una miniatura, o `null` si la URL no es una
 * miniatura. Se deshace quitando el sufijo, nunca reconstruyendo el nombre:
 * por eso la miniatura se llama `<nombre completo>.w400.jpg` y no
 * `<nombre>.w400.jpg`, para que valga aunque el original no sea un `.jpg`.
 */
export function originalImageUrl(url: string): string | null {
  const match = url.match(VARIANT_SUFFIX);
  return match ? url.slice(0, -match[0].length) : null;
}

/**
 * La URL con la que pintar una foto en un hueco de `width` píxeles.
 *
 * Lo que no sea una foto pública de Storage (una previsualización `blob:` de
 * una foto recién hecha, una URL firmada con `?token=`) se devuelve tal cual:
 * mejor sin encoger que rota.
 */
export function supabaseImageUrl(src: string, width: number): string {
  if (!src.includes(PUBLIC_OBJECT) || src.includes("?")) return src;
  if (isThumbName(src)) return src;
  const variant = THUMB_WIDTHS.find((w) => w >= width);
  return variant ? thumbName(src, variant) : src;
}

export default function supabaseImageLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  // `quality` se ignora a propósito: la calidad ya se decidió al generar cada
  // fichero, aquí no hay nada que recomprimir.
  return supabaseImageUrl(src, width);
}
