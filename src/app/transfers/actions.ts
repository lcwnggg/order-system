"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";

// 门店角色校验（服务端动作可被直接 POST，必须逐个校验）
async function requireStore(): Promise<SupabaseClient | null> {
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

  if (profile?.role !== "store") return null;
  return supabase;
}

// 认领 / 流转状态：门店和仓库老板都可（仓库万一自己有货也能接）；具体归属由 RPC 内部校验
async function requireStoreOrWarehouse(): Promise<SupabaseClient | null> {
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

  if (profile?.role !== "store" && profile?.role !== "warehouse") return null;
  return supabase;
}

function revalidate() {
  revalidatePath("/transfers");
  revalidatePath("/admin/orders");
}

export async function createTransferRequest(input: {
  itemText: string;
  photoUrl?: string | null;
  quantity?: number | null;
  note?: string | null;
}): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await requireStore();
  if (!supabase) return { error: t("common.noPermission") };

  const { error } = await supabase.rpc("create_transfer_request", {
    p_item_text: input.itemText,
    p_photo_url: input.photoUrl ?? null,
    p_quantity: input.quantity ?? null,
    p_note: input.note ?? null,
  });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}

export async function claimTransferRequest(id: string): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await requireStoreOrWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  const { error } = await supabase.rpc("claim_transfer_request", { p_id: id });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}

export async function declineTransferRequest(id: string): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await requireStore();
  if (!supabase) return { error: t("common.noPermission") };

  const { error } = await supabase.rpc("decline_transfer_request", { p_id: id });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}

export async function setTransferStatus(
  id: string,
  status: "done" | "open" | "cancelled"
): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await requireStoreOrWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

  const { error } = await supabase.rpc("update_transfer_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}
