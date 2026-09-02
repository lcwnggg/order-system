"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Translate } from "@/lib/i18n/translate";
import { THUMB_WIDTHS, isThumbName, thumbName } from "./supabase-image-loader";

/** El único cubo de fotos de la aplicación. */
export const IMAGE_BUCKET = "product-images";

/** Ancho máximo del original. Más que esto no se aprecia y pesa el doble. */
const FULL_WIDTH = 1200;
/** Las miniaturas se ven pequeñas: se puede apretar más la calidad. */
const THUMB_QUALITY = 0.72;

/**
 * Encoge una foto a JPEG en el propio navegador.
 *
 * Estaba copiado en cuatro pantallas (alta, edición, reconocimiento por IA y
 * traspasos); ahora vive aquí, que es donde también se generan las miniaturas.
 */
export function resizeToJpeg(
  file: File | Blob,
  t: Translate,
  maxWidth = FULL_WIDTH,
  quality = 0.8
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(t("common.canvasUnavailable")));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t("common.compressFailed")))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(t("common.imageLoadFailed")));
    };
    img.src = objectUrl;
  });
}

/**
 * Genera y sube las miniaturas de una foto ya subida.
 *
 * Es un extra, nunca un requisito: si falla cualquiera de ellas se sigue
 * adelante sin decir nada, porque la foto ya está guardada y el original se
 * puede servir igual (ver `supabase-image-loader.ts`). Fallar aquí no puede
 * costarle al usuario el producto que estaba dando de alta.
 *
 * Devuelve cuántas se subieron, que es lo que necesita la pantalla de
 * mantenimiento; el resto de sitios lo ignoran.
 */
export async function uploadThumbnails(
  supabase: SupabaseClient,
  fileName: string,
  image: Blob,
  t: Translate,
  widths: readonly number[] = THUMB_WIDTHS
): Promise<number> {
  let done = 0;
  for (const width of widths) {
    try {
      const small = await resizeToJpeg(image, t, width, THUMB_QUALITY);
      const { error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(thumbName(fileName, width), small, {
          contentType: "image/jpeg",
          // Sin `upsert`: sobrescribir necesita permiso de UPDATE en el cubo y
          // aquí nunca hace falta, las miniaturas se generan una sola vez. Si
          // ya existe, el error se ignora igual que cualquier otro.
          upsert: false,
        });
      if (!error) done += 1;
    } catch {
      /* la miniatura es un extra: sin ella se sirve el original */
    }
  }
  return done;
}

/**
 * Sube una foto al cubo y devuelve su URL pública, dejando ya generadas las
 * miniaturas con las que se pintan las listas.
 *
 * Todas las subidas de fotos de la aplicación pasan por aquí para que ninguna
 * pantalla pueda olvidarse de las miniaturas: el día que se olvide una, esas
 * fotos vuelven a bajarse enteras para un recuadro de 40 px.
 */
export async function uploadProductImage(
  supabase: SupabaseClient,
  image: Blob,
  t: Translate,
  { prefix = "" }: { prefix?: string } = {}
): Promise<string> {
  const fileName = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(fileName, image, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(error.message);

  await uploadThumbnails(supabase, fileName, image, t);

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

/**
 * Borra del cubo una foto y sus miniaturas. Se usa al recortar de nuevo una
 * foto recién subida, que nunca llegó a guardarse en ningún producto.
 */
export async function removeProductImage(supabase: SupabaseClient, url: string): Promise<void> {
  try {
    const fileName = url.split(`/${IMAGE_BUCKET}/`).pop();
    if (!fileName) return;
    const original = decodeURIComponent(fileName);
    if (isThumbName(original)) return;
    await supabase.storage
      .from(IMAGE_BUCKET)
      .remove([original, ...THUMB_WIDTHS.map((w) => thumbName(original, w))]);
  } catch {
    /* que no se borre un fichero suelto no debe romper nada */
  }
}
