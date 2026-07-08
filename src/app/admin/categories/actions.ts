"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "分类名称不能为空" };

  const { error } = await supabase
    .from("categories")
    .insert({ name: trimmed, parent_id: parentId || null });

  if (error) return { error: error.message };

  revalidateAll();
  return { success: true };
}

export async function renameCategory(id: string, name: string): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "分类名称不能为空" };

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
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const { count } = await supabase
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", id);

  if (count && count > 0) {
    return { error: `请先删除该大类下的 ${count} 个小类，再删除大类` };
  }

  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateAll();
  return { success: true };
}
