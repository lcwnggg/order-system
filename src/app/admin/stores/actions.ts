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

export async function updateStoreName(
  storeId: string,
  storeName: string
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const name = storeName.trim();

  const { error } = await supabase
    .from("profiles")
    .update({ store_name: name || null })
    .eq("id", storeId);

  if (error) return { error: error.message };

  revalidatePath("/admin/stores");
  revalidatePath("/admin/orders");
  return { success: true };
}
