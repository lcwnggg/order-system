"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";

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

export async function updateOrderStatus(
  orderId: string,
  newStatus: "preparing" | "done"
): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  // 失败必须回传：以前这里吞掉错误直接 return，界面上按钮转一圈就恢复原样，
  // 看起来像成功了，实际订单状态没变（RLS 拦截、约束冲突等都会这样）。
  const { error } = await supabase
    .from("orders")
    .update({ status: newStatus })
    .eq("id", orderId);
  if (error) return { error: translateDbError(error.message, t) };

  revalidatePath("/admin/orders");
  return {};
}

export async function deleteOrder(orderId: string): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  // delete_order RPC 内部再次校验角色 + 状态（仅 done/cancelled 可删），连带删 order_items
  const { error } = await supabase.rpc("delete_order", { p_order_id: orderId });
  if (error) return { error: translateDbError(error.message, t) };

  revalidatePath("/admin/orders");
  return {};
}
