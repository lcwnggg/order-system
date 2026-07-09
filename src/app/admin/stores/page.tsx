import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
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
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Link
              href="/"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              ← 首页
            </Link>
            <span className="text-zinc-300">/</span>
            <Link
              href="/admin/products"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              商品管理
            </Link>
            <span className="text-zinc-300">/</span>
            <Link
              href="/admin/orders"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
            >
              订单管理
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-semibold text-zinc-900">门店管理</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-zinc-500 sm:block">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">门店管理</h1>
          <p className="mt-1 text-sm text-zinc-400">
            为每家门店设置易识别的店名，订单管理页将优先显示店名。
          </p>
        </div>
        <StoresClient stores={stores} />
      </main>
    </div>
  );
}
