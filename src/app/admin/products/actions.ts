"use server";

import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { guardMessage, requireRole } from "@/lib/supabase/guard";
import { isValidBarcodeFormat, normalizeBarcode } from "@/lib/barcode";
import { parseDecimal } from "@/lib/decimal";
import { splitImages } from "@/lib/product-images";
import { isMissingColumnError, saveWithOptionalColumns } from "@/lib/optional-columns";
import { newUntilFromNow } from "@/lib/new-in";
import { getT } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translate";

/**
 * `warning` = se guardó, pero algo secundario no.
 *
 * Importa la diferencia con `error`: devolver un error después de haber creado
 * ya la fila del producto deja el formulario lleno y al usuario convencido de
 * que no se ha guardado nada, así que le da a «Añadir» otra vez y acaba con el
 * producto duplicado. Si el producto está dentro, esto es un éxito con un
 * aviso, no un fallo.
 */
export type ActionResult = { error: string } | { success: true; warning?: string };

export type ProductVariant = {
  id: string;
  product_id: string;
  color: string;
  stock: number;
  sort_order: number;
};

/**
 * Datos privados de compra. Viven en `product_costs`, una tabla aparte cuya RLS
 * solo deja pasar al rol `warehouse`: si estuvieran como columnas de `products`
 * cualquier empleado podría leerlos desde el navegador con la anon key, porque
 * RLS filtra filas, no columnas.
 */
export type ProductCost = {
  product_id: string;
  cost_price: number | null;
  supplier: string | null;
  note: string | null;
};

type CostInput = {
  cost_price: number | null;
  supplier: string | null;
  note: string | null;
};

/** Postgres: la tabla no existe (falta ejecutar supabase/product_costs.sql). */
const UNDEFINED_TABLE = "42P01";

function isCostEmpty(cost: CostInput) {
  return cost.cost_price === null && !cost.supplier && !cost.note;
}

/**
 * Guarda (o limpia) el coste/proveedor de un producto. Asume permisos ya comprobados.
 *
 * Devuelve `t("err.costTableMissing")` si la tabla aún no está creada, en vez de
 * escupir el error crudo de Postgres: es el único fallo que se puede arreglar
 * desde fuera de la aplicación, y conviene decir exactamente cómo.
 */
async function saveCost(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productId: string,
  cost: CostInput,
  t: Translate
): Promise<string | null> {
  if (isCostEmpty(cost)) {
    // Sin nada que apuntar, no dejamos una fila vacía rondando. Si la tabla no
    // existe todavía tampoco hay nada que borrar: no es motivo para tumbar el
    // guardado del producto entero.
    const { error } = await supabase.from("product_costs").delete().eq("product_id", productId);
    if (error && error.code !== UNDEFINED_TABLE) return error.message;
    return null;
  }
  const { error } = await supabase
    .from("product_costs")
    .upsert(
      { product_id: productId, cost_price: cost.cost_price, supplier: cost.supplier, note: cost.note },
      { onConflict: "product_id" }
    );
  if (error?.code === UNDEFINED_TABLE) return t("err.costTableMissing");
  return error?.message ?? null;
}

/** Lee los campos privados de un FormData, normalizando vacíos a null. */
function readCostFromForm(formData: FormData): CostInput | { error: "invalidCost" } {
  const rawCost = ((formData.get("cost_price") as string) ?? "").trim();
  const cost_price = rawCost === "" ? null : parseDecimal(rawCost);
  if (cost_price !== null && (isNaN(cost_price) || cost_price < 0)) return { error: "invalidCost" };
  return {
    cost_price,
    supplier: ((formData.get("supplier") as string) ?? "").trim() || null,
    note: ((formData.get("cost_note") as string) ?? "").trim() || null,
  };
}

/**
 * Lista de fotos extra que manda el formulario (JSON). Si viniera cualquier
 * cosa rara, se ignora: perder una foto no justifica tumbar el alta entera.
 */
function readImageList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Aviso para una columna que se añade a mano en Supabase y todavía no existe.
 * Solo se llega aquí si se estaban guardando datos suyos: sin datos, se guarda
 * el resto del producto y no se molesta a nadie.
 */
function missingColumnMessage(column: string, t: Translate): string {
  return column === "new_until"
    ? t("err.newInColumnMissing")
    : t("err.extraImagesColumnMissing");
}

type VariantInput = {
  id?: string;
  color: string;
  stock: number;
  sort_order: number;
  _delete?: boolean;
};

async function requireWarehouse() {
  return requireRole("warehouse");
}

export async function addProduct(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const price = parseDecimal(formData.get("price") as string);
  const has_variants = formData.get("has_variants") === "true";
  const stock = has_variants ? 0 : parseInt(formData.get("stock") as string, 10);
  // Portada + fotos extra. Se normaliza todo junto para que la portada sea
  // siempre la primera y no se cuele ninguna repetida.
  const { image_url, image_urls } = splitImages([
    (formData.get("image_url") as string) || "",
    ...readImageList(formData.get("image_urls") as string | null),
  ]);
  const category_id = (formData.get("category_id") as string) || null;
  const brand = (formData.get("brand") as string)?.trim() || null;
  const barcode = normalizeBarcode(formData.get("barcode") as string);
  const variantsJson = (formData.get("variants") as string) || "[]";
  // «New in»: se guarda la fecha de caducidad de la novedad, no un sí/no.
  const new_until = formData.get("new_in") === "true" ? newUntilFromNow() : null;

  if (!name) return { error: t("err.productNameRequired") };
  if (isNaN(price) || price < 0) return { error: t("err.invalidPrice") };
  if (!has_variants && (isNaN(stock) || stock < 0)) return { error: t("err.invalidStock") };
  if (!isValidBarcodeFormat(barcode)) return { error: t("err.barcodeInvalid") };

  const cost = readCostFromForm(formData);
  if ("error" in cost) return { error: t("err.invalidCostPrice") };

  let variants: { color: string; stock: number }[] = [];
  if (has_variants) {
    try {
      variants = JSON.parse(variantsJson);
    } catch {
      return { error: t("err.variantJson") };
    }
    if (variants.length === 0) return { error: t("err.variantAtLeastOne") };
    if (variants.some((v) => !v.color?.trim())) return { error: t("err.colorNameRequired") };
  }

  const base = { name, description: description || null, price, stock, image_url, category_id, has_variants, brand, barcode };
  // `image_urls` y `new_until` se crean a mano (supabase/product_extra_images.sql
  // y supabase/new_in.sql). Mientras no existan: si iban vacías, el producto se
  // guarda igual; si llevaban datos, mejor avisar que tragárselos en silencio.
  const insert = await saveWithOptionalColumns<{ id: string }>(
    { image_urls, new_until },
    (column) => (column === "new_until" ? new_until !== null : image_urls.length > 0),
    (optional) => supabase.from("products").insert({ ...base, ...optional }).select("id").single()
  );
  if ("blockedColumn" in insert) return { error: missingColumnMessage(insert.blockedColumn, t) };
  const { data: product, error: insertErr } = insert;
  if (insertErr) return { error: insertErr.message ?? t("err.productNotSaved") };
  if (!product) return { error: t("err.productNotSaved") };

  // A partir de aquí el producto YA existe: lo que falle se avisa, pero no se
  // devuelve como error (ver ActionResult) o el usuario lo añadiría dos veces.
  const warnings: string[] = [];

  const costErr = await saveCost(supabase, product.id, cost, t);
  if (costErr) warnings.push(costErr);

  if (has_variants && variants.length > 0) {
    const { error: varErr } = await supabase.from("product_variants").insert(
      variants.map((v, i) => ({
        product_id: product.id,
        color: v.color.trim(),
        stock: v.stock,
        sort_order: i,
      }))
    );
    if (varErr) warnings.push(t("err.variantsNotSaved", { message: varErr.message }));
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/shop");
  return warnings.length > 0
    ? { success: true, warning: warnings.join(" ") }
    : { success: true };
}

export async function updateProduct(
  id: string,
  fields: {
    name: string;
    description: string;
    price: number;
    stock: number;
    /** Galería completa (portada primero). `undefined` = no tocar las fotos. */
    images?: string[];
    category_id?: string | null;
    has_variants?: boolean;
    brand?: string | null;
    barcode?: string | null;
    /**
     * Fin del periodo «New in» (ISO), `null` para quitarlo del apartado.
     * `undefined` = no tocar lo que hubiera.
     */
    new_until?: string | null;
    /** Datos privados; `undefined` = no tocar lo que ya hubiera guardado. */
    cost?: { cost_price: number | null; supplier: string | null; note: string | null };
  }
): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { name, description, price, stock, images, category_id, has_variants, brand, barcode, new_until, cost } = fields;
  if (!name) return { error: t("err.productNameRequired") };
  if (isNaN(price) || price < 0) return { error: t("err.invalidPrice") };
  if (has_variants !== true && (isNaN(stock) || stock < 0)) return { error: t("err.invalidStock") };
  if (barcode !== undefined && !isValidBarcodeFormat(barcode)) {
    return { error: t("err.barcodeInvalid") };
  }
  if (cost?.cost_price != null && (isNaN(cost.cost_price) || cost.cost_price < 0)) {
    return { error: t("err.invalidCostPrice") };
  }

  const updateData: Record<string, unknown> = {
    name,
    description: description.trim() || null,
    price,
    stock,
  };
  // Columnas que se añaden a mano: van aparte para poder reintentar sin ellas.
  const optional: Record<string, unknown> = {};
  if (images !== undefined) {
    const split = splitImages(images);
    updateData.image_url = split.image_url;
    optional.image_urls = split.image_urls;
  }
  if (new_until !== undefined) optional.new_until = new_until;
  if (category_id !== undefined) updateData.category_id = category_id;
  if (has_variants !== undefined) updateData.has_variants = has_variants;
  if (brand !== undefined) updateData.brand = brand;
  if (barcode !== undefined) updateData.barcode = normalizeBarcode(barcode);

  // Mismo apaño que al crear: sin la columna todavía creada, se guarda el resto
  // salvo que se estuvieran guardando datos suyos (ahí se avisa).
  const saved = await saveWithOptionalColumns<null>(
    optional,
    (column) =>
      column === "new_until"
        ? new_until != null
        : Array.isArray(optional.image_urls) && optional.image_urls.length > 0,
    (columns) => supabase.from("products").update({ ...updateData, ...columns }).eq("id", id).then((r) => ({ data: null, error: r.error }))
  );
  if ("blockedColumn" in saved) return { error: missingColumnMessage(saved.blockedColumn, t) };
  if (saved.error) return { error: saved.error.message ?? t("err.productNotSaved") };

  if (cost !== undefined) {
    const costErr = await saveCost(supabase, id, cost, t);
    if (costErr) return { error: costErr };
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/shop");
  return { success: true };
}

export async function upsertVariants(
  productId: string,
  variants: VariantInput[]
): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  for (const v of variants) {
    if (v._delete && v.id) {
      const { error } = await supabase.from("product_variants").delete().eq("id", v.id);
      if (error) return { error: error.message };
    } else if (v.id) {
      const { error } = await supabase
        .from("product_variants")
        .update({ color: v.color.trim(), stock: v.stock, sort_order: v.sort_order })
        .eq("id", v.id);
      if (error) return { error: error.message };
    } else if (!v._delete) {
      const { error } = await supabase.from("product_variants").insert({
        product_id: productId,
        color: v.color.trim(),
        stock: v.stock,
        sort_order: v.sort_order,
      });
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/shop");
  return { success: true };
}

export async function adjustVariantStock(variantId: string, delta: number): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;
  if (!Number.isInteger(delta) || delta <= 0) return { error: t("err.deltaPositiveInt") };

  // 原子自增，避免读-改-写竞态（两人同时 +N 会丢更新）
  const { error } = await supabase.rpc("adjust_variant_stock", {
    p_id: variantId,
    p_delta: delta,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/shop");
  return { success: true };
}

export async function toggleProductActive(id: string, isActive: boolean): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { error } = await supabase.from("products").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/shop");
  return { success: true };
}

/**
 * Marca o quita un producto del apartado «New in».
 *
 * Marcarlo siempre reinicia el contador a NEW_IN_DAYS días: si se vuelve a
 * pulsar sobre algo que ya era novedad, es justo lo que se quiere (ha llegado
 * remesa nueva y se quiere que la vean otros diez días).
 */
export async function setProductNewIn(id: string, isNew: boolean): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { error } = await supabase
    .from("products")
    .update({ new_until: isNew ? newUntilFromNow() : null })
    .eq("id", id);
  if (error) {
    return { error: isMissingColumnError(error) ? t("err.newInColumnMissing") : error.message };
  }

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  // 保护历史：被历史订单引用过的商品禁止硬删除（会破坏订单明细/金额）。
  // 这类商品应「下架」（is_active=false）而不是删除。仅从未被下单过的商品可真正删除。
  const { count, error: countErr } = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);
  if (countErr) return { error: countErr.message };
  if ((count ?? 0) > 0) {
    return { error: t("err.productInOrders") };
  }

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  return { success: true };
}

export async function adjustStock(id: string, delta: number): Promise<ActionResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;
  if (!Number.isInteger(delta) || delta <= 0) return { error: t("err.deltaPositiveInt") };

  // 原子自增，避免读-改-写竞态（两人同时 +N 会丢更新）
  const { error } = await supabase.rpc("adjust_product_stock", {
    p_id: id,
    p_delta: delta,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/shop");
  return { success: true };
}

// ── 批量导入 ──
// 第一版只处理无变体的普通商品；同名行（无论是否与已有商品同名）一律走
// 跳过/覆盖/全部新建 三选一处理。变体商品请继续用单个创建/编辑界面。

export type BulkImportRow = {
  nombre: string;
  marca: string | null;
  categoryId: string | null;
  precio: number;
  stock: number;
  barcode: string | null;
  isDuplicate: boolean;
  existingProductId?: string;
};

export type BulkImportMode = "skip" | "overwrite" | "new";

export type BulkImportResult =
  | { imported: number; skipped: number; failed: number; errors: string[] }
  | { error: string };

export async function bulkImportProducts(
  rows: BulkImportRow[],
  mode: BulkImportMode
): Promise<BulkImportResult> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;
  if (rows.length === 0) return { error: t("err.nothingToImport") };

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  // 重复商品：按模式分别处理
  const toOverwrite = rows.filter((r) => r.isDuplicate && mode === "overwrite");
  const toSkip = rows.filter((r) => r.isDuplicate && mode === "skip");
  const toInsertNew = rows.filter((r) => !r.isDuplicate || mode === "new");

  skipped += toSkip.length;

  // 覆盖已有商品：逐条更新（数量通常较少），只更新 products 表的普通字段
  for (const row of toOverwrite) {
    if (!row.existingProductId) {
      // 同名但不是已有商品的重复（文件内重名，找不到可覆盖的目标）
      skipped++;
      continue;
    }
    const { error: updErr } = await supabase
      .from("products")
      .update({
        price: row.precio,
        brand: row.marca,
        category_id: row.categoryId,
        stock: row.stock,
        barcode: normalizeBarcode(row.barcode),
      })
      .eq("id", row.existingProductId);
    if (updErr) {
      failed++;
      errors.push(`${row.nombre}: ${updErr.message}`);
      continue;
    }
    imported++;
  }

  // 新商品：批量插入
  if (toInsertNew.length > 0) {
    const { error: insErr } = await supabase.from("products").insert(
      toInsertNew.map((row) => ({
        name: row.nombre,
        brand: row.marca,
        category_id: row.categoryId,
        price: row.precio,
        has_variants: false,
        stock: row.stock,
        barcode: normalizeBarcode(row.barcode),
      }))
    );

    if (insErr) {
      failed += toInsertNew.length;
      errors.push(t("err.bulkInsertFailed", { message: insErr.message }));
    } else {
      imported += toInsertNew.length;
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/stock-alert");
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
  return { imported, skipped, failed, errors };
}
