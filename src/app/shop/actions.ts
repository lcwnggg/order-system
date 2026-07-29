"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";

type OrderItem = { productId: string; quantity: number; variantId?: string };
type OrderResult = { success: true; orderId: string } | { error: string };

export async function submitOrder(items: OrderItem[], note?: string): Promise<OrderResult> {
  const t = await getT();
  if (!items.length) return { error: t("cart.empty") };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "store") return { error: t("common.noPermission") };

  const p_items = items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    ...(item.variantId ? { variant_id: item.variantId } : {}),
  }));

  const { data: orderId, error } = await supabase.rpc("place_order", {
    p_items,
  });

  if (error) {
    // Postgres RAISE EXCEPTION 的消息在 error.message 里（中文写死，按当前语言翻一遍）
    return { error: translateDbError(error.message, t) };
  }

  // 备注可选：单独写入，不阻断下单主流程
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    await supabase.rpc("set_order_note", {
      p_order_id: orderId as string,
      p_note: trimmedNote,
    });
  }

  revalidatePath("/shop");
  revalidatePath("/shop/orders");
  revalidatePath("/admin/products");

  return { success: true, orderId: orderId as string };
}

export async function cancelOrder(orderId: string): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "store") return { error: t("common.noPermission") };

  // cancel_order RPC 内部再次校验订单归属 + 状态，并事务内回补库存
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { error: translateDbError(error.message, t) };

  revalidatePath("/shop/orders");
  revalidatePath("/shop");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/products");
  return {};
}
