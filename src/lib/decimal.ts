/**
 * Precios escritos a mano en el móvil.
 *
 * El teclado numérico de Android/iOS ofrece la coma o el punto según el idioma
 * del teclado, y `<input type="number">` descarta lo que no encaje con su
 * configuración: en un móvil con coma, escribir «12,50» dejaba el campo vacío y
 * no había forma de poner decimales. Por eso los campos de dinero son de texto
 * con `inputMode="decimal"` y aceptan los dos separadores; aquí se limpia lo
 * escrito y se convierte a número.
 */

/**
 * Deja pasar solo lo que puede formar parte de un número: dígitos y UN
 * separador decimal (coma o punto, el que haya escrito la persona; se conserva
 * tal cual para no pelearse con el cursor mientras teclea).
 */
export function sanitizeDecimalText(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const firstSep = cleaned.search(/[.,]/);
  if (firstSep === -1) return cleaned;
  const head = cleaned.slice(0, firstSep + 1);
  const tail = cleaned.slice(firstSep + 1).replace(/[.,]/g, "");
  return head + tail;
}

/** «12,50» y «12.50» valen lo mismo. Vacío o ilegible → NaN. */
export function parseDecimal(raw: string | null | undefined): number {
  if (raw == null) return NaN;
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") return NaN;
  return Number(normalized);
}
