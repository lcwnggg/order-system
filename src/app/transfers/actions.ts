"use server";

import { revalidatePath } from "next/cache";
import { guardMessage, requireRole } from "@/lib/supabase/guard";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";
import type { TransferMode } from "@/lib/transfers";

// 门店角色校验（服务端动作可被直接 POST，必须逐个校验）
async function requireStore() {
  return requireRole("store");
}

// 认领 / 流转状态：门店和仓库老板都可（仓库万一自己有货也能接）；具体归属由 RPC 内部校验
async function requireStoreOrWarehouse() {
  return requireRole("store", "warehouse");
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
  mode?: TransferMode;
}): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireStore();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { error } = await supabase.rpc("create_transfer_request", {
    p_item_text: input.itemText,
    p_photo_url: input.photoUrl ?? null,
    p_quantity: input.quantity ?? null,
    p_note: input.note ?? null,
    p_mode: input.mode ?? "single",
  });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}

/** 「我有」：single 是独占认领；multi 是报名 quantity 件，别家还能继续报。 */
export async function claimTransferRequest(
  id: string,
  quantity?: number | null
): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireStoreOrWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { error } = await supabase.rpc("claim_transfer_request", {
    p_id: id,
    p_quantity: quantity ?? null,
  });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}

/** multi 模式：管理自己报的那一份（已交货 / 退回备货中 / 撤回报名）。 */
export async function updateTransferClaim(
  id: string,
  action: "done" | "claimed" | "withdraw"
): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireStoreOrWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { error } = await supabase.rpc("update_transfer_claim", {
    p_id: id,
    p_action: action,
  });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}

export async function declineTransferRequest(id: string): Promise<{ error?: string }> {
  const t = await getT();
  const guard = await requireStore();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

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
  const guard = await requireStoreOrWarehouse();
  if ("error" in guard) return { error: guardMessage(guard, t) };
  const { supabase } = guard;

  const { error } = await supabase.rpc("update_transfer_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { error: translateDbError(error.message, t) };

  revalidate();
  return {};
}
