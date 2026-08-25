"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";
import { sendPushToUser } from "@/lib/push";

type OrderItem = { productId: string; quantity: number; variantId?: string };
/** Línea escrita a mano: texto libre + cantidad, sin producto ni precio. */
type WrittenItem = { description: string; quantity: number };
type OrderResult =
  | { success: true; orderId: string; warning?: string }
  | { error: string };

export async function submitOrder(
  items: OrderItem[],
  note?: string,
  writtenItems: WrittenItem[] = []
): Promise<OrderResult> {
  const t = await getT();
  const written = writtenItems.filter((w) => w.description.trim() && w.quantity > 0);
  // Un pedido puede ser solo de líneas escritas (nada del catálogo)
  if (!items.length && !written.length) return { error: t("cart.empty") };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, warehouse_id, store_name")
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

  // Líneas escritas a mano: van a `order_custom_items` por RPC. Si el script
  // supabase/order_custom_items.sql todavía no se ha ejecutado, el pedido ya
  // está guardado y estas líneas se perderían en silencio — por eso el fallo se
  // devuelve como aviso visible en vez de tragárselo.
  let warning: string | undefined;
  if (written.length) {
    const { error: writtenError } = await supabase.rpc("add_order_custom_items", {
      p_order_id: orderId as string,
      p_items: written.map((w) => ({
        description: w.description.trim(),
        quantity: w.quantity,
      })),
    });
    if (writtenError) {
      warning = `${t("written.saveFailed")} (${translateDbError(writtenError.message, t)})`;
    }
  }

  // 备注可选：单独写入，不阻断下单主流程
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    await supabase.rpc("set_order_note", {
      p_order_id: orderId as string,
      p_note: trimmedNote,
    });
  }

  // Aviso al móvil del almacén. Va después de que el pedido ya esté guardado y
  // envuelto en try/catch: si el push falla (claves sin configurar, servicio
  // caído, nadie suscrito) el pedido sigue siendo válido igualmente.
  if (profile.warehouse_id) {
    try {
      const totalUnits =
        items.reduce((sum, i) => sum + i.quantity, 0) +
        written.reduce((sum, w) => sum + w.quantity, 0);
      await sendPushToUser(profile.warehouse_id as string, {
        title: t("push.newOrderTitle"),
        body: t("push.newOrderBody", {
          store: (profile.store_name as string | null) ?? user.email ?? "",
          units: totalUnits,
          lines: items.length + written.length,
        }),
        url: "/admin/orders",
        tag: `order-${orderId}`,
      });
    } catch {
      /* el aviso es un extra, nunca puede hacer fracasar el pedido */
    }
  }

  revalidatePath("/shop");
  revalidatePath("/shop/orders");
  revalidatePath("/admin/products");
  revalidatePath("/admin/orders");

  return { success: true, orderId: orderId as string, ...(warning ? { warning } : {}) };
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
