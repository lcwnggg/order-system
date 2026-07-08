"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
): Promise<void> {
  const supabase = await requireWarehouse();
  if (!supabase) return;

  await supabase
    .from("orders")
    .update({ status: newStatus })
    .eq("id", orderId);

  revalidatePath("/admin/orders");
}
