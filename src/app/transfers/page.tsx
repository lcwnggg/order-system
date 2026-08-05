import { redirect } from "next/navigation";
import { denyPage, requireRole } from "@/lib/supabase/guard";
import AppShell from "@/app/app-shell";
import { getTransferBoard, getGroupStores } from "@/lib/transfers";
import { getI18n } from "@/lib/i18n/server";
import TransfersClient from "./transfers-client";
import TransferAlerts from "./transfer-alerts";

export default async function TransfersPage() {
  const { t } = await getI18n();
  const guard = await requireRole("store", "warehouse");
  if ("error" in guard) denyPage(guard, t);
  const { supabase, user, profile } = guard;

  // 仓库老板从订单管理页看互调，这里只服务门店
  if (profile.role === "warehouse") redirect("/admin/orders");

  const [requests, stores] = await Promise.all([
    getTransferBoard(supabase),
    getGroupStores(supabase),
  ]);

  return (
    <AppShell variant="store" email={user.email} displayName={profile?.store_name}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">
            {t("transfers.eyebrow")}
          </p>
          <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">{t("transfers.title")}</h1>
          <p className="mt-1.5 text-sm text-paper-500">{t("transfers.subtitle")}</p>
        </div>
        <TransferAlerts currentUserId={user.id} />
      </div>
      <TransfersClient requests={requests} stores={stores} currentStoreId={user.id} />
    </AppShell>
  );
}
