import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import AdminNav from "@/app/admin/admin-nav";
import StoresClient, { type StoreUser } from "./stores-client";

export default async function AdminStoresPage() {
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
      email: "（请先执行建表 SQL 以显示邮箱）",
      store_name: p.store_name as string | null,
    }));
  } else {
    stores = (rpcStores ?? []) as StoreUser[];
  }

  return (
    <div className="min-h-screen bg-sage-100">
      <header className="border-b border-sage-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <AdminNav />
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-sage-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-sage-200 px-3 py-1.5 text-sm text-sage-700 transition-colors hover:bg-sage-100"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-sage-900">门店管理</h1>
          <p className="mt-1 text-sm text-sage-500">
            为每家门店设置易识别的店名，订单管理页将优先显示店名。
          </p>
        </div>
        <StoresClient stores={stores} />
      </main>
    </div>
  );
}
