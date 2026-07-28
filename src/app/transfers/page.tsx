import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import { getTransferBoard } from "@/lib/transfers";
import TransfersClient from "./transfers-client";

export default async function TransfersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, store_name")
    .eq("id", user.id)
    .single();

  // 仓库老板从订单管理页看互调，这里只服务门店
  if (profile?.role === "warehouse") redirect("/admin/orders");
  if (profile?.role !== "store") redirect("/login");

  const requests = await getTransferBoard(supabase);

  return (
    <AppShell variant="store" email={user.email} displayName={profile?.store_name}>
      <div className="mb-2">
        <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">
          门店 — 互相调货
        </p>
        <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">门店互调</h1>
        <p className="mt-1.5 text-sm text-paper-500">缺货、仓库也没有？问问其他门店谁有。</p>
      </div>
      <TransfersClient requests={requests} currentStoreId={user.id} />
    </AppShell>
  );
}
