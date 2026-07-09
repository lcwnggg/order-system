"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type OrderItem = { productId: string; quantity: number; variantId?: string };
type OrderResult = { success: true; orderId: string } | { error: string };

export async function submitOrder(items: OrderItem[]): Promise<OrderResult> {
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

  revalidatePath("/shop");
  revalidatePath("/admin/products");

  return { success: true, orderId: orderId as string };
}
