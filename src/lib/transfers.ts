import type { SupabaseClient } from "@supabase/supabase-js";

export type TransferStatus = "open" | "claimed" | "done" | "cancelled";

/**
 * single = 只要一家店（第一个说「我有」的独占认领）
 * multi  = 想把所有门店手上有的都收上来，请求一直开放，谁有谁报名
 */
export type TransferMode = "single" | "multi";

/** multi 模式下的一条报名（哪家店、能给几件、备好了没）。 */
export type TransferClaim = {
  storeId: string;
  storeName: string | null;
  quantity: number | null;
  status: "claimed" | "done";
};

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
  mode: TransferMode;
  claimedBy: string | null;
  claimerName: string | null;
  createdAt: string;
  iDeclined: boolean;
  /** multi 模式下已报名的门店（single 恒为空数组） */
  claims: TransferClaim[];
  /** 我在这条 multi 请求里报的那一份；没报名为 null */
  myClaimStatus: "claimed" | "done" | null;
  myClaimQuantity: number | null;
};

type RpcClaim = {
  store_id: string;
  store_name: string | null;
  quantity: number | null;
  status: "claimed" | "done";
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
  mode: TransferMode | null;
  claimed_by: string | null;
  claimer_name: string | null;
  created_at: string;
  i_declined: boolean;
  claims: RpcClaim[] | null;
  my_claim_status: "claimed" | "done" | null;
  my_claim_quantity: number | null;
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
    // 还没跑 transfer_multi_store.sql 时 RPC 不返回 mode，退回旧的独占模式
    mode: r.mode === "multi" ? "multi" : "single",
    claimedBy: r.claimed_by,
    claimerName: r.claimer_name,
    createdAt: r.created_at,
    iDeclined: r.i_declined,
    claims: (r.claims ?? []).map((c) => ({
      storeId: c.store_id,
      storeName: c.store_name,
      quantity: c.quantity,
      status: c.status,
    })),
    myClaimStatus: r.my_claim_status ?? null,
    myClaimQuantity: r.my_claim_quantity ?? null,
  }));
}
