/**
 * Orden alfabético para todo lo que se elige de una lista (categorías, sobre
 * todo). La base de datos las devuelve por `sort_order`, que nadie ha ordenado
 * nunca a mano: en la práctica salían por orden de creación, y encontrar una
 * categoría entre veinte era una lotería.
 *
 * Se ordena en el navegador y con el idioma activo: `Intl.Collator` coloca la Ñ
 * y los acentos donde toca en español, y en chino ordena por pinyin, cosa que
 * un `ORDER BY name` de Postgres no hace.
 */
export function nameCollator(localeTag?: string): Intl.Collator {
  return new Intl.Collator(localeTag, { numeric: true, sensitivity: "base" });
}

/** Copia ordenada por `name`. No toca el array original. */
export function sortByName<T extends { name: string | null }>(
  items: readonly T[],
  localeTag?: string
): T[] {
  const collator = nameCollator(localeTag);
  return [...items].sort((a, b) => collator.compare(a.name ?? "", b.name ?? ""));
}
