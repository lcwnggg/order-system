"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export type ActionResult = { error: string } | { success: true };

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

function revalidateAll() {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
}

export async function addCategory(
  name: string,
  parentId: string | null
): Promise<ActionResult> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  const trimmed = name.trim();
  if (!trimmed) return { error: t("err.categoryNameRequired") };

  const { error } = await supabase
    .from("categories")
    .insert({ name: trimmed, parent_id: parentId || null });

  if (error) return { error: error.message };

  revalidateAll();
  return { success: true };
}

export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  const trimmed = name.trim();
  if (!trimmed) return { error: t("err.categoryNameRequired") };

  const { error } = await supabase
    .from("categories")
    .update({ name: trimmed })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidateAll();
  revalidatePath("/shop");
  return { success: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  const { count } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);

  if (count && count > 0) {
    return { error: t("err.deleteChildrenFirst", { n: count }) };
  }

  // Antes de borrar la categoría hay que soltar los productos que cuelgan de ella.
  // Si no, el resultado depende de cómo esté declarada la FK products.category_id
  // en Supabase, y ninguna de las tres opciones es aceptable a ciegas:
  //   ON DELETE CASCADE  → borraría los productos junto con la categoría (pérdida de datos)
  //   ON DELETE RESTRICT → error de Postgres en crudo delante del usuario
  //   ON DELETE SET NULL → correcto, pero solo por suerte
  // Desasignarlos explícitamente da el mismo resultado en los tres casos.
  const { error: unassignErr } = await supabase
    .from("products")
    .update({ category_id: null })
    .eq("category_id", id);
  if (unassignErr) return { error: unassignErr.message };

  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateAll();
  revalidatePath("/shop");
  return { success: true };
}

export async function assignProductsToCategory(
  categoryId: string,
  productIds: string[]
): Promise<ActionResult> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };
  if (!productIds.length) return { error: t("err.selectAtLeastOneProduct") };

  const { error } = await supabase
    .from("products")
    .update({ category_id: categoryId })
    .in("id", productIds);

  if (error) return { error: error.message };

  revalidateAll();
  revalidatePath("/shop");
  return { success: true };
}

export async function removeProductFromCategory(
  productId: string
): Promise<ActionResult> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  const { error } = await supabase
    .from("products")
    .update({ category_id: null })
    .eq("id", productId);

  if (error) return { error: error.message };

  revalidateAll();
  revalidatePath("/shop");
  return { success: true };
}
