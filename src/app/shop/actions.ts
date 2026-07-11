"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type OrderItem = { productId: string; quantity: number; variantId?: string };
type OrderResult = { success: true; orderId: string } | { error: string };

export async function submitOrder(items: OrderItem[], note?: string): Promise<OrderResult> {
  if (!items.length) return { error: "购物车为空" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登录" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "store") return { error: "无权限" };

  const p_items = items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    ...(item.variantId ? { variant_id: item.variantId } : {}),
  }));

  const { data: orderId, error } = await supabase.rpc("place_order", {
    p_items,
  });

  if (error) {
    // Postgres RAISE EXCEPTION 的消息在 error.message 里
    return { error: error.message };
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登录" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "store") return { error: "无权限" };

  // cancel_order RPC 内部再次校验订单归属 + 状态，并事务内回补库存
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) return { error: error.message };

  revalidatePath("/shop/orders");
  revalidatePath("/shop");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/products");
  return {};
}
