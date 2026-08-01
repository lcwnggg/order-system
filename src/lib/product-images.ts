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

/**
 * La columna no existe todavía (falta ejecutar supabase/product_extra_images.sql).
 *
 * Hay que mirar dos códigos: al leer, el error viene de Postgres (`42703`); al
 * escribir, PostgREST corta antes y devuelve el suyo (`PGRST204`, "Could not
 * find the 'image_urls' column of 'products' in the schema cache").
 */
export function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/**
 * Lanza una consulta pidiendo también `image_urls` y, si esa columna todavía no
 * existe en la base de datos, la repite sin ella.
 *
 * El SQL de este proyecto se ejecuta a mano: sin esto, desplegar antes de
 * ejecutarlo dejaría el catálogo entero vacío en vez de simplemente sin fotos
 * extra. `column` llega como `", image_urls"` o como cadena vacía.
 */
export async function withExtraImagesColumn<T>(
  run: (column: string) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
): Promise<{ data: T | null; error: { code?: string } | null }> {
  // El tipado de Supabase deduce las columnas del literal del `select`, y aquí
  // se arma en tiempo de ejecución: el tipo lo pone quien llama.
  const result = await run(", image_urls");
  const final = isMissingColumnError(result.error) ? await run("") : result;
  return { data: (final.data ?? null) as T | null, error: final.error };
}

/** Reparte una galería en las dos columnas de la tabla. */
export function splitImages(images: string[]): { image_url: string | null; image_urls: string[] } {
  const clean = [...new Set(images.map((u) => u.trim()).filter(Boolean))];
  return { image_url: clean[0] ?? null, image_urls: clean.slice(1) };
}
