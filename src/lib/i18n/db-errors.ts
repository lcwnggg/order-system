import type { TranslationKey } from "./dictionaries";
import type { Translate } from "./translate";

// Postgres 函数里的 RAISE EXCEPTION 消息是中文写死的（见 supabase/*.sql），
// 会原样从 RPC 冒到前端。这里按原文映射到词条 key，让西语用户也能读懂。
// 改 SQL 里的文案时，记得同步这张表。
const DB_MESSAGE_KEYS: Record<string, TranslationKey> = {
  无权限: "common.noPermission",
  无权限或门店未关联仓库: "db.noPermissionOrNoWarehouse",
  商品不存在或不属于本仓库: "db.productNotFoundInWarehouse",
  颜色变体不存在: "db.variantNotFound",
  颜色变体库存不足: "db.variantOutOfStock",
  商品不存在: "db.productNotFound",
  商品库存不足: "db.productOutOfStock",
  无权删除订单: "db.cannotDeleteOrder",
  无权修改该订单: "db.cannotModifyOrder",
  无权取消该订单: "db.cannotCancelOrder",
  订单不存在: "db.orderNotFound",
  订单不属于本仓库: "db.orderNotInWarehouse",
  只有已完成或已取消的订单可以删除: "db.onlyDoneOrCancelledDeletable",
  只有待处理订单可以取消: "db.onlyPendingCancellable",
  请填写要调的货: "transfers.itemRequired",
  请求不存在: "db.requestNotFound",
  该请求不属于本仓库分组: "db.requestNotInGroup",
  不能认领自己发起的请求: "db.cannotClaimOwn",
  该请求已被认领或已结束: "db.requestAlreadyClaimed",
  只有备货门店可标记完成: "db.onlyClaimerCanComplete",
  当前状态不可标记完成: "db.cannotCompleteNow",
  只有备货门店可退回: "db.onlyClaimerCanRelease",
  当前状态不可退回: "db.cannotReleaseNow",
  只有发起门店可撤销: "db.onlyRequesterCanCancel",
  当前状态不可撤销: "db.cannotCancelNow",
};

/** 认得的 DB 报错翻成当前语言；认不得的原样返回（总比吞掉信息好）。 */
export function translateDbError(message: string, t: Translate): string {
  const key = DB_MESSAGE_KEYS[message.trim()];
  return key ? t(key) : message;
}
