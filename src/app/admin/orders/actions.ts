"use server";

import { revalidatePath } from "next/cache";
import { guardMessage, requireRole } from "@/lib/supabase/guard";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";

async function requireWarehouse() {
  return requireRole("warehouse");
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: "preparing" | "done"
): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

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

/** Nombre libre que el almacén le pone al pedido. Vacío = volver al nombre de la tienda. */
export async function renameOrder(
  orderId: string,
  title: string
): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const trimmed = title.trim();
  if (trimmed.length > 80) return { error: t("adminOrders.titleTooLong") };

  const { error } = await supabase
    .from("orders")
    .update({ title: trimmed || null })
    .eq("id", orderId);
  if (error) return { error: translateDbError(error.message, t) };

  revalidatePath("/admin/orders");
  return {};
}

export async function deleteOrder(orderId: string): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  // delete_order RPC 内部再次校验角色 + 状态（仅 done/cancelled 可删），连带删 order_items
  const { error } = await supabase.rpc("delete_order", { p_order_id: orderId });
  if (error) return { error: translateDbError(error.message, t) };

  revalidatePath("/admin/orders");
  return {};
}
