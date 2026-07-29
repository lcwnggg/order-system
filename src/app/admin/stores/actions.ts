"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";

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
  const t = await getT();
  const supabase = await requireWarehouse();
  if (!supabase) return { error: t("common.noPermission") };

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
  const t = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "warehouse") return { error: t("common.noPermission") };

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) return { error: t("err.emailInvalid") };
  if (password.length < 6) return { error: t("err.passwordTooShort") };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: t("err.noServiceRole") };
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
      return { error: t("err.emailTaken") };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/stores");
  return { success: true };
}
