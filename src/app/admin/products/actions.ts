"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string } | { success: true };

export type ProductVariant = {
  id: string;
  product_id: string;
  color: string;
  stock: number;
  sort_order: number;
};

type VariantInput = {
  id?: string;
  color: string;
  stock: number;
  sort_order: number;
  _delete?: boolean;
};

async function requireWarehouse() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "warehouse") return null;
  return supabase;
}

export async function addProduct(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const price = parseFloat(formData.get("price") as string);
  const has_variants = formData.get("has_variants") === "true";
  const stock = has_variants ? 0 : parseInt(formData.get("stock") as string, 10);
  const image_url = (formData.get("image_url") as string) || null;
  const category_id = (formData.get("category_id") as string) || null;
  const brand = (formData.get("brand") as string)?.trim() || null;
  const variantsJson = (formData.get("variants") as string) || "[]";

  if (!name) return { error: "商品名称不能为空" };
  if (isNaN(price) || price < 0) return { error: "请输入有效价格" };
  if (!has_variants && (isNaN(stock) || stock < 0)) return { error: "请输入有效库存数量" };

  let variants: { color: string; stock: number }[] = [];
  if (has_variants) {
    try {
      variants = JSON.parse(variantsJson);
    } catch {
      return { error: "颜色变体数据格式错误" };
    }
    if (variants.length === 0) return { error: "开启颜色变体时至少添加一种颜色" };
    if (variants.some((v) => !v.color?.trim())) return { error: "颜色名称不能为空" };
  }

  const { data: product, error: insertErr } = await supabase
    .from("products")
    .insert({ name, description: description || null, price, stock, image_url, category_id, has_variants, brand })
    .select("id")
    .single();
  if (insertErr) return { error: insertErr.message };

  if (has_variants && variants.length > 0) {
    const { error: varErr } = await supabase.from("product_variants").insert(
      variants.map((v, i) => ({
        product_id: product.id,
        color: v.color.trim(),
        stock: v.stock,
        sort_order: i,
      }))
    );
    if (varErr) return { error: varErr.message };
  }

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

export async function updateProduct(
  id: string,
  fields: {
    name: string;
    description: string;
    price: number;
    stock: number;
    newImageUrl?: string | null; // null = 删除图片，undefined = 保留原图
    category_id?: string | null;
    has_variants?: boolean;
    brand?: string | null;
  }
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const { name, description, price, stock, newImageUrl, category_id, has_variants, brand } = fields;
  if (!name) return { error: "商品名称不能为空" };
  if (isNaN(price) || price < 0) return { error: "请输入有效价格" };
  if (has_variants !== true && (isNaN(stock) || stock < 0)) return { error: "请输入有效库存数量" };

  const updateData: Record<string, unknown> = {
    name,
    description: description.trim() || null,
    price,
    stock,
  };
  if (newImageUrl !== undefined) updateData.image_url = newImageUrl;
  if (category_id !== undefined) updateData.category_id = category_id;
  if (has_variants !== undefined) updateData.has_variants = has_variants;
  if (brand !== undefined) updateData.brand = brand;

  const { error } = await supabase.from("products").update(updateData).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

export async function upsertVariants(
  productId: string,
  variants: VariantInput[]
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

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
  revalidatePath("/shop");
  return { success: true };
}

export async function adjustVariantStock(variantId: string, delta: number): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };
  if (!Number.isInteger(delta) || delta <= 0) return { error: "增加数量必须是正整数" };

  const { data: variant } = await supabase
    .from("product_variants")
    .select("stock")
    .eq("id", variantId)
    .single();
  if (!variant) return { error: "变体不存在" };

  const { error } = await supabase
    .from("product_variants")
    .update({ stock: variant.stock + delta })
    .eq("id", variantId);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

export async function toggleProductActive(id: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const { error } = await supabase.from("products").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  return { success: true };
}

export async function adjustStock(id: string, delta: number): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };
  if (!Number.isInteger(delta) || delta <= 0) return { error: "增加数量必须是正整数" };

  const { data: product } = await supabase
    .from("products")
    .select("stock")
    .eq("id", id)
    .single();
  if (!product) return { error: "商品不存在" };

  const { error } = await supabase
    .from("products")
    .update({ stock: product.stock + delta })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
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
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };
  if (rows.length === 0) return { error: "没有可导入的商品" };

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
      }))
    );

    if (insErr) {
      failed += toInsertNew.length;
      errors.push(`批量新增商品失败：${insErr.message}`);
    } else {
      imported += toInsertNew.length;
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
  return { imported, skipped, failed, errors };
}
