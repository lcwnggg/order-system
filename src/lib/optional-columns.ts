/**
 * Columnas que todavía pueden no existir en la base de datos.
 *
 * El SQL de este proyecto se ejecuta a mano en Supabase, así que entre
 * desplegar y ejecutarlo hay un rato en el que el código pide columnas que
 * aún no están (`image_urls`, `new_until`…). Sin estas ayudas, ese rato deja
 * el catálogo entero vacío en vez de simplemente sin esa función.
 */

type DbError = { code?: string; message?: string } | null;

/**
 * La columna no existe todavía.
 *
 * Hay que mirar dos códigos: al leer, el error viene de Postgres (`42703`); al
 * escribir, PostgREST corta antes y devuelve el suyo (`PGRST204`, "Could not
 * find the 'image_urls' column of 'products' in the schema cache").
 *
 * Con `column`, además comprueba que sea *esa* columna la que falta: ambos
 * errores nombran la columna en el mensaje.
 */
export function isMissingColumnError(error: DbError, column?: string): boolean {
  const missing = error?.code === "42703" || error?.code === "PGRST204";
  if (!missing || !column) return missing;
  return (error?.message ?? "").includes(column);
}

/**
 * Lanza una consulta pidiendo también unas columnas opcionales y, si alguna no
 * existe, la quita y reintenta. `run` recibe el trozo a pegar al final del
 * `select` (`", image_urls, new_until"`, o cadena vacía si no queda ninguna).
 *
 * Si el error no dice qué columna falta, se quitan todas: mejor el catálogo
 * completo sin adornos que una pantalla en blanco.
 */
export async function withOptionalColumns<T>(
  columns: string[],
  run: (fragment: string) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<{ data: T | null; error: DbError }> {
  // El tipado de Supabase deduce las columnas del literal del `select`, y aquí
  // se arma en tiempo de ejecución: el tipo lo pone quien llama.
  let remaining = columns;
  for (;;) {
    const result = await run(remaining.map((c) => `, ${c}`).join(""));
    if (remaining.length === 0 || !isMissingColumnError(result.error)) {
      return { data: (result.data ?? null) as T | null, error: result.error };
    }
    const named = remaining.filter((c) => isMissingColumnError(result.error, c));
    remaining = named.length > 0 ? remaining.filter((c) => !named.includes(c)) : [];
  }
}

/**
 * Guarda (insert/update) con unas columnas opcionales y, si alguna no existe,
 * la quita y reintenta.
 *
 * `isNeeded` decide qué pasa con cada columna que falte: si la columna llevaba
 * datos que el usuario acaba de introducir, tragárselos en silencio sería
 * mentirle, así que se corta y se devuelve cuál es (quien llama traduce el
 * aviso de «ejecuta el SQL»). Si iba vacía, se guarda el resto y ya está.
 */
export async function saveWithOptionalColumns<T>(
  optional: Record<string, unknown>,
  isNeeded: (column: string) => boolean,
  run: (columns: Record<string, unknown>) => PromiseLike<{ data: T | null; error: DbError }>
): Promise<{ data: T | null; error: DbError } | { blockedColumn: string }> {
  let remaining = { ...optional };
  for (;;) {
    const result = await run(remaining);
    const names = Object.keys(remaining);
    if (names.length === 0 || !isMissingColumnError(result.error)) return result;

    const named = names.filter((c) => isMissingColumnError(result.error, c));
    const missing = named.length > 0 ? named : names;
    const blocked = missing.find(isNeeded);
    if (blocked) return { blockedColumn: blocked };
    remaining = Object.fromEntries(
      Object.entries(remaining).filter(([c]) => !missing.includes(c))
    );
  }
}
