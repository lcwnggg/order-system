/**
 * Fotos de un producto.
 *
 * La portada vive en `products.image_url` (es la que sale en listas, carrito y
 * pedidos) y las fotos extra en `products.image_urls`. Las pantallas no deberían
 * saber ese reparto: piden `productImages()` y reciben la galería completa, con
 * la portada siempre primero.
 */
export type ProductImageSource = {
  image_url?: string | null;
  image_urls?: string[] | null;
};

/** Galería completa, portada primero, sin huecos ni repetidas. */
export function productImages(p: ProductImageSource): string[] {
  const all = [p.image_url, ...(p.image_urls ?? [])]
    .map((u) => u?.trim())
    .filter((u): u is string => !!u);
  return [...new Set(all)];
}

/**
 * Foto de portada. Cae en la primera extra si `image_url` está vacío: así un
 * producto con fotos nunca se ve sin ninguna, pase lo que pase con los datos.
 */
export function coverImage(p: ProductImageSource): string | null {
  return productImages(p)[0] ?? null;
}

/** Reparte una galería en las dos columnas de la tabla. */
export function splitImages(images: string[]): { image_url: string | null; image_urls: string[] } {
  const clean = [...new Set(images.map((u) => u.trim()).filter(Boolean))];
  return { image_url: clean[0] ?? null, image_urls: clean.slice(1) };
}
