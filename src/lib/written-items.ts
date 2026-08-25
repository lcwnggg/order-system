/**
 * «Pedidos escritos»: líneas que la tienda escribe a mano porque el artículo no
 * está en el catálogo (protectores, cables sueltos, accesorios que no hemos
 * subido…). Aquí solo vive la interpretación del texto; el guardado va por el
 * RPC `add_order_custom_items` (supabase/order_custom_items.sql).
 *
 * La idea: el empleado escribe «protector completo 16 pro max x5», pulsa Enter y
 * sale una línea con cantidad 5. Nunca falla en silencio: si no se reconoce
 * ninguna cantidad se pone 1, y la cantidad siempre queda visible y editable en
 * pantalla, que es la red de seguridad de verdad.
 */

export type WrittenLine = {
  description: string;
  quantity: number;
  /**
   * Número suelto al final que PODRÍA ser la cantidad («funda rosa 3»). No se
   * aplica solo: en una tienda de móviles el número final suele ser el modelo
   * («protector 16», «cable 2m»), así que la línea entra con cantidad 1 y la UI
   * ofrece un «×3?» de un toque. Nunca inventamos cantidades.
   */
  qtyHint?: number;
};

const MAX_QTY = 999;
const MAX_DESC = 200;

/** Viñetas y numeración de listas pegadas desde WhatsApp / Excel / notas. */
const BULLET = /^\s*(?:[-–—•*·]|\d{1,2}[.)])\s+/;

/** «5 x funda» / «5x funda» */
const QTY_PREFIX = /^(\d{1,4})\s*[x*×]\s*(.+)$/i;
/**
 * «funda x5» / «funda *5» / «funda × 5». El lookbehind es imprescindible: sin
 * él la «x» de «16 pro max 5» hace de marca y la descripción pierde la letra.
 */
const QTY_SUFFIX = /^(.*?)[\s,;·-]*(?<!\p{L})[x*×]\s*(\d{1,4})$/iu;
/** «funda 5 uds» / «funda 5u» / «funda 5 unidades» / «funda 5个» */
const QTY_UNITS =
  /^(.*?)[\s,;]+(\d{1,4})\s*(?:uds?|unidad(?:es)?|u|pcs?|pzas?|个|件|支|套|条)\.?$/i;
/** «protector completo 16 pro max 5»: número suelto al final de una frase. */
const QTY_BARE = /^(.*?[^\d\s])\s+(\d{1,4})$/;
/** Celdas de hoja de cálculo: «descripción<TAB>cantidad». */
const CELL_SPLIT = /\t+/;

function clean(text: string) {
  return text.replace(BULLET, "").replace(/\s+/g, " ").trim();
}

function clampQty(raw: string) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QTY);
}

function finish(description: string, quantity: number, qtyHint?: number): WrittenLine | null {
  // Separadores sobrantes al recortar la cantidad. Ojo: aquí NO se puede quitar
  // la «x» final, o «16 pro max» se quedaría en «16 pro ma».
  const desc = description.replace(/[\s,;:·-]+$/, "").trim().slice(0, MAX_DESC);
  if (!desc) return null;
  return qtyHint ? { description: desc, quantity, qtyHint } : { description: desc, quantity };
}

/**
 * Interpreta UNA línea escrita a mano. Devuelve null si no queda nada legible.
 * Prioridad: marcas explícitas (x5, 5 uds) por delante del número suelto final,
 * que es el caso ambiguo («…16 pro max 5» → 5 unidades, pero «…completo 16»
 * también leería 16). Por eso la cantidad se muestra siempre con sus −/+.
 */
export function parseWrittenLine(input: string): WrittenLine | null {
  // Pegado desde una hoja de cálculo: «descripción<TAB>cantidad». Ahí la
  // columna de al lado SÍ es una cantidad sin ninguna ambigüedad.
  const cells = input.split(CELL_SPLIT).map((c) => c.trim()).filter(Boolean);
  if (cells.length >= 2 && /^\d{1,4}$/.test(cells[cells.length - 1])) {
    return finish(clean(cells.slice(0, -1).join(" ")), clampQty(cells[cells.length - 1]));
  }

  const text = clean(input);
  if (!text) return null;

  let m = text.match(QTY_PREFIX);
  if (m) return finish(m[2], clampQty(m[1]));

  m = text.match(QTY_SUFFIX);
  if (m) return finish(m[1], clampQty(m[2]));

  m = text.match(QTY_UNITS);
  if (m) return finish(m[1], clampQty(m[2]));

  // Número suelto al final: NO se aplica, se guarda como sugerencia. En este
  // negocio «protector 16» es un modelo, no dieciséis protectores.
  m = text.match(QTY_BARE);
  if (m && m[1].includes(" ")) return finish(text, 1, clampQty(m[2]));

  return finish(text, 1);
}

/**
 * Interpreta un bloque de texto: una línea por artículo. Sirve para pegar de
 * golpe una lista de WhatsApp o una columna de Excel. También parte por «;»,
 * y por tabuladores/«,» cuando la línea viene de una hoja de cálculo con la
 * cantidad en la columna de al lado («protector completo\t5»).
 */
export function parseWrittenLines(input: string): WrittenLine[] {
  return input
    .split(/[\n\r;]+/)
    .map((line) => parseWrittenLine(line))
    .filter((l): l is WrittenLine => l !== null);
}

/** ¿El texto pegado trae varias líneas? Decide si añadimos una o todas. */
export function isMultiline(text: string) {
  return /[\n\r]/.test(text.trim());
}
