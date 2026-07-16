import { createClient } from "@supabase/supabase-js";

// ⚠️ 仅服务端使用：service role 会绕过 RLS。
// 只用于老板在后台创建门店账号（auth.admin.createUser）。
// service role key 只从服务端环境变量读取，绝不能出现在客户端包里。
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY 环境变量");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
