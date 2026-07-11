-- ⚠️⚠️ 行级安全（RLS）—— 审计 #1，最重要但也最需要小心的一步 ⚠️⚠️
--
-- 背景：anon key 会打包进浏览器，任何登录用户都能拿它 + 自己的 session
-- 直接经 PostgREST 读写数据库、绕过你所有的 server action 校验。因此真正的
-- 权限必须落在数据库的 RLS 上。开启 RLS 后：默认「全部禁止」，只有下面
-- 明确 GRANT 的 POLICY 放行。
--
-- 执行前请务必：
--   1. 先跑最下面「第 0 步」的查询，看现在哪些表还没开 RLS。
--   2. 强烈建议先在 Supabase 的一个 database branch / 测试项目上跑一遍，
--      然后完整走查：门店登录 → 浏览商品 → 下单 → 看我的订单 → 取消；
--      仓库登录 → 看全部订单 → 备货 → 改库存 → 删订单。
--   3. 一切正常再在生产执行。若下单在开启 RLS 后失败，说明你的 place_order
--      不是 SECURITY DEFINER —— 把报错发我，我给你对应处理。
--
-- 幂等：可重复执行。

-- ─────────────────────────────────────────────
-- 辅助函数：判断当前用户是否仓库角色。
-- SECURITY DEFINER 读 profiles → 绕过 profiles 自身的 RLS，避免策略递归。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_warehouse()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'warehouse'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_warehouse() TO authenticated;

-- ═════════════════════════════════════════════
-- profiles：自己能看自己，仓库能看/改所有；
--   关键——门店对 profiles 没有任何 UPDATE 策略 ⇒ 无法把自己改成 warehouse。
-- ═════════════════════════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_warehouse());

DROP POLICY IF EXISTS profiles_update_warehouse ON public.profiles;
CREATE POLICY profiles_update_warehouse ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_warehouse())
  WITH CHECK (public.is_warehouse());
-- 说明：新用户的 profiles 行由 handle_new_user() 触发器（SECURITY DEFINER）插入，
-- 绕过 RLS，所以这里不需要 INSERT 策略。

-- ═════════════════════════════════════════════
-- products / product_variants / categories：
--   所有登录用户可读；只有仓库可增删改。
-- ═════════════════════════════════════════════
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS products_write ON public.products;
CREATE POLICY products_write ON public.products
  FOR ALL TO authenticated
  USING (public.is_warehouse()) WITH CHECK (public.is_warehouse());

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS product_variants_write ON public.product_variants;
CREATE POLICY product_variants_write ON public.product_variants
  FOR ALL TO authenticated
  USING (public.is_warehouse()) WITH CHECK (public.is_warehouse());

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS categories_write ON public.categories;
CREATE POLICY categories_write ON public.categories
  FOR ALL TO authenticated
  USING (public.is_warehouse()) WITH CHECK (public.is_warehouse());

-- ═════════════════════════════════════════════
-- orders：门店只能看自己的，仓库能看全部；仓库可改状态。
--   下单/取消/备注/删除都走 SECURITY DEFINER RPC（绕过 RLS），
--   所以这里【故意不给】门店 INSERT/UPDATE/DELETE 策略——防止门店绕过
--   place_order 直接造订单而不扣库存。
-- ═════════════════════════════════════════════
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (store_id = auth.uid() OR public.is_warehouse());
DROP POLICY IF EXISTS orders_update_warehouse ON public.orders;
CREATE POLICY orders_update_warehouse ON public.orders
  FOR UPDATE TO authenticated
  USING (public.is_warehouse()) WITH CHECK (public.is_warehouse());

-- ═════════════════════════════════════════════
-- order_items：可见性跟随父订单（门店看自己的、仓库看全部）。
--   写入同样只走 RPC，不给直接写策略。
-- ═════════════════════════════════════════════
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (o.store_id = auth.uid() OR public.is_warehouse())
    )
  );

-- ═════════════════════════════════════════════
-- get_store_users()：审计指出——它是 SECURITY DEFINER 且读 auth.users.email，
-- 若内部没校验调用者是仓库，任何登录用户都能拉全部门店邮箱（GDPR 泄露）。
-- 它的定义不在仓库，我看不到。请执行下面这句把现有定义打出来发我：
--   SELECT pg_get_functiondef('public.get_store_users'::regproc);
-- 我据此在函数体开头加：
--   IF NOT public.is_warehouse() THEN RAISE EXCEPTION '无权限'; END IF;
-- （先别自行乱改，避免破坏它原本的返回结构。）
-- ═════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 第 0 步：先跑这个看现状（哪些表 rowsecurity=false 就是还没开）
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
-- ─────────────────────────────────────────────
