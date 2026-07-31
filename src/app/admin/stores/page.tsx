import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import { nameCollator } from "@/lib/sort";
import StoresClient, { type StoreUser } from "./stores-client";

export default async function AdminStoresPage() {
  const { t, tag } = await getI18n();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "warehouse") redirect("/login");

  // get_store_users() 是一个 SECURITY DEFINER RPC，能读到 auth.users.email
  const { data: rpcStores, error: rpcError } = await supabase.rpc("get_store_users");

  let stores: StoreUser[] = [];
  if (rpcError) {
    // RPC 不存在时降级：只用 profiles 表，不显示邮箱
    const { data: profileStores } = await supabase
      .from("profiles")
      .select("id, store_name")
      .eq("role", "store");
    stores = (profileStores ?? []).map((p) => ({
      id: p.id as string,
      email: t("stores.emailFallback"),
      store_name: p.store_name as string | null,
    }));
  } else {
    stores = (rpcStores ?? []) as StoreUser[];
  }

  // Ni el RPC ni la consulta de respaldo ordenan: la lista salía como
  // quisiera la base de datos. Alfabético por nombre de tienda (y por correo
  // las que aún no tienen nombre).
  const collator = nameCollator(tag);
  stores.sort((a, b) =>
    collator.compare(a.store_name?.trim() || a.email, b.store_name?.trim() || b.email)
  );

  return (
    <AppShell email={user.email}>
        <div className="mb-6">
          <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.22em] text-paper-500">{t("stores.eyebrow")}</p>
          <h1 className="animate-fade-up mt-2 text-3xl font-normal tracking-tight text-paper-900">{t("stores.title")}</h1>
          <p className="mt-1 text-sm text-paper-500">{t("stores.subtitle")}</p>
        </div>
        <StoresClient stores={stores} />
      </AppShell>
  );
}
