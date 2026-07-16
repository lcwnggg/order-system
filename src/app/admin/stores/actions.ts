"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { error: string } | { success: true };

async function requireWarehouse() {
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

  if (profile?.role !== "warehouse") return null;
  return supabase;
}

export async function updateStoreName(
  storeId: string,
  storeName: string
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const name = storeName.trim();

  const { error } = await supabase
    .from("profiles")
    .update({ store_name: name || null })
    .eq("id", storeId);

  if (error) return { error: error.message };

  revalidatePath("/admin/stores");
  revalidatePath("/admin/orders");
  return { success: true };
}

// 老板创建门店(员工)账号：邮箱 + 密码，直接激活，绑定到当前老板的仓库。
// 需要服务端配置 SUPABASE_SERVICE_ROLE_KEY（Supabase admin API）。
export async function createStoreAccount(
  email: string,
  password: string,
  storeName: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未登录" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "warehouse") return { error: "无权限" };

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) return { error: "邮箱格式不正确" };
  if (password.length < 6) return { error: "密码至少需要 6 位" };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "服务端未配置 SUPABASE_SERVICE_ROLE_KEY，暂时无法创建账号" };
  }

  // handle_new_user 触发器会读取 user_metadata 里的 warehouse_id / store_name
  // 建好 profiles 行（role 默认 store）。email_confirm=true 让员工可直接登录。
  const { error } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: {
      warehouse_id: user.id,
      store_name: storeName.trim(),
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return { error: "该邮箱已被注册" };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/stores");
  return { success: true };
}
