/**
 * «New in»: el apartado de novedades del catálogo.
 *
 * Un producto es novedad porque el almacén lo marca, no por su fecha de alta:
 * hay género que se da de alta hoy y no interesa destacar, y remesas que llegan
 * semanas después de haberse creado la ficha.
 *
 * En la base de datos solo vive `products.new_until` (cuándo deja de ser
 * novedad). Al marcarlo se apunta hoy + NEW_IN_DAYS y a partir de ahí el
 * producto se cae solo del apartado: nadie tiene que volver a tocarlo.
 */
export const NEW_IN_DAYS = 10;

const DAY_MS = 86_400_000;

export type NewInSource = { new_until?: string | null };

/** Fin del periodo de novedad si se marca ahora mismo (ISO, para la base de datos). */
export function newUntilFromNow(from: Date = new Date()): string {
  return new Date(from.getTime() + NEW_IN_DAYS * DAY_MS).toISOString();
}

/** ¿Sigue siendo novedad? Con `new_until` vacío o pasado, no. */
export function isNewIn(p: NewInSource, now: number = Date.now()): boolean {
  if (!p.new_until) return false;
  const until = new Date(p.new_until).getTime();
  return !isNaN(until) && until > now;
}

/**
 * Días que le quedan como novedad (redondeando hacia arriba: el último día
 * sigue contando como «1», no como «0»). 0 si ya no lo es.
 */
export function newInDaysLeft(p: NewInSource, now: number = Date.now()): number {
  if (!p.new_until) return 0;
  const until = new Date(p.new_until).getTime();
  if (isNaN(until) || until <= now) return 0;
  return Math.ceil((until - now) / DAY_MS);
}
