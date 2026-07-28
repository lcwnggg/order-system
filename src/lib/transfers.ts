import type { SupabaseClient } from "@supabase/supabase-js";

export type TransferStatus = "open" | "claimed" | "done" | "cancelled";

// 看板一行（get_transfer_board RPC 返回）
export type TransferRequest = {
  id: string;
  requesterStoreId: string;
  requesterName: string | null;
  itemText: string;
  photoUrl: string | null;
  quantity: number | null;
  note: string | null;
  status: TransferStatus;
  claimedBy: string | null;
  claimerName: string | null;
  createdAt: string;
  iDeclined: boolean;
};

type RpcRow = {
  id: string;
  requester_store_id: string;
  requester_name: string | null;
  item_text: string;
  photo_url: string | null;
  quantity: number | null;
  note: string | null;
  status: TransferStatus;
  claimed_by: string | null;
  claimer_name: string | null;
  created_at: string;
  i_declined: boolean;
};

export type GroupStore = { id: string; name: string | null };

/** 当前老板范围内的所有门店（画「每家店一个圈」的看板用）。 */
export async function getGroupStores(
  supabase: SupabaseClient
): Promise<GroupStore[]> {
  const { data, error } = await supabase.rpc("get_group_stores");
  // RPC 失败时降级为空看板（页面不崩），但要在服务端日志留痕，否则「看板是空的」无从排查
  if (error) console.error("[transfers] get_group_stores 失败：", error.message);
  return ((data as { id: string; name: string | null }[] | null) ?? []).map((s) => ({
    id: s.id,
    name: s.name,
  }));
}

/** 拉取当前老板范围内的全部互调请求（门店 / 仓库共用）。 */
export async function getTransferBoard(
  supabase: SupabaseClient
): Promise<TransferRequest[]> {
  const { data, error } = await supabase.rpc("get_transfer_board");
  if (error) console.error("[transfers] get_transfer_board 失败：", error.message);
  return ((data as RpcRow[] | null) ?? []).map((r) => ({
    id: r.id,
    requesterStoreId: r.requester_store_id,
    requesterName: r.requester_name,
    itemText: r.item_text,
    photoUrl: r.photo_url,
    quantity: r.quantity,
    note: r.note,
    status: r.status,
    claimedBy: r.claimed_by,
    claimerName: r.claimer_name,
    createdAt: r.created_at,
    iDeclined: r.i_declined,
  }));
}
