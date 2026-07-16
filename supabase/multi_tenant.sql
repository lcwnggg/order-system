-- ═══════════════════════════════════════════════════════════════
-- 多租户改造（multi-tenant）
--   每个「老板」= 一个 role='warehouse' 的 profile。
--   其名下的 门店(store) / 商品(products) / 分类(categories) / 订单(orders)
--   通过 warehouse_id 互相隔离：门店只能看到自己老板的目录，老板只能看到自己的数据。
--
-- 幂等：可重复执行。
-- ⚠️ 执行顺序：必须在以下脚本之后执行——
--    enable_rls.sql → security_integrity.sql →
--    place_order_snapshot_and_get_store_users.sql → delete_order.sql →
--    order_cancel_and_note.sql → 本脚本。
-- ⚠️ 生产执行前强烈建议先在 Supabase database branch 上跑一遍并完整走查。
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 1. 结构：新增归属列 warehouse_id
--    - profiles.warehouse_id：门店指向其老板(warehouse)的 id；老板自身为 NULL
--    - products / categories / orders.warehouse_id：归属某个老板
-- ───────────────────────────────────────────────
ALTER TABLE public.profiles   ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.products   ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.orders     ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_products_warehouse   ON public.products(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_categories_warehouse ON public.categories(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse     ON public.orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_profiles_warehouse   ON public.profiles(warehouse_id);


-- ───────────────────────────────────────────────
-- 2. 历史数据回填：把现有数据归到「最早的那个老板」名下。
--    如果你已手动建了多个 warehouse，本步会把所有旧数据都归给最早那个；
--    需要时之后可再手动 UPDATE ... SET warehouse_id = '<另一个老板>'。
-- ───────────────────────────────────────────────
DO $$
DECLARE v_wh uuid;
BEGIN
  SELECT id INTO v_wh
  FROM public.profiles
  WHERE role = 'warehouse'
  ORDER BY created_at NULLS FIRST
  LIMIT 1;

  IF v_wh IS NULL THEN
    RAISE EXCEPTION '未找到 role=warehouse 的老板账号；请先在 Supabase 建一个老板账号再执行本脚本';
  END IF;

  UPDATE public.products   SET warehouse_id = v_wh WHERE warehouse_id IS NULL;
  UPDATE public.categories SET warehouse_id = v_wh WHERE warehouse_id IS NULL;
  UPDATE public.orders     SET warehouse_id = v_wh WHERE warehouse_id IS NULL;
  UPDATE public.profiles   SET warehouse_id = v_wh WHERE role = 'store' AND warehouse_id IS NULL;
END $$;

-- 回填后置为 NOT NULL（这三张表的每行都必须归属某个老板）。
-- profiles.warehouse_id 保持可空（老板自身为 NULL）。
ALTER TABLE public.products   ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.categories ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE public.orders     ALTER COLUMN warehouse_id SET NOT NULL;


-- ───────────────────────────────────────────────
-- 3. 归属判定辅助函数：当前用户所属的「老板范围」
--    warehouse 用户 → 自己的 id；store 用户 → 自己的 warehouse_id。
--    SECURITY DEFINER 读 profiles，避开 profiles 自身 RLS 递归。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_warehouse_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT CASE WHEN role = 'warehouse' THEN id ELSE warehouse_id END
  FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.current_warehouse_id() TO authenticated;


-- ───────────────────────────────────────────────
-- 4. 自动填充 warehouse_id（BEFORE INSERT 触发器）
--    这样 addProduct / 分类创建 / 批量导入 等应用代码【无需改动】：
--    插入时自动把 warehouse_id 设为当前老板，随后 RLS 的 WITH CHECK 即通过。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_warehouse_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    NEW.warehouse_id := public.current_warehouse_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_owner_products ON public.products;
CREATE TRIGGER set_owner_products BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_warehouse_owner();

DROP TRIGGER IF EXISTS set_owner_categories ON public.categories;
CREATE TRIGGER set_owner_categories BEFORE INSERT ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_warehouse_owner();


-- ───────────────────────────────────────────────
-- 5. RLS 策略：全部改为按 warehouse_id 隔离
-- ───────────────────────────────────────────────
-- profiles：自己可见；老板可见/可改「自己名下」的门店
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR (public.is_warehouse() AND warehouse_id = auth.uid()));

DROP POLICY IF EXISTS profiles_update_warehouse ON public.profiles;
CREATE POLICY profiles_update_warehouse ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_warehouse() AND warehouse_id = auth.uid())
  WITH CHECK (public.is_warehouse() AND warehouse_id = auth.uid());

-- products
DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated
  USING (warehouse_id = public.current_warehouse_id());
DROP POLICY IF EXISTS products_write ON public.products;
CREATE POLICY products_write ON public.products
  FOR ALL TO authenticated
  USING (public.is_warehouse() AND warehouse_id = auth.uid())
  WITH CHECK (public.is_warehouse() AND warehouse_id = auth.uid());

-- categories
DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select ON public.categories
  FOR SELECT TO authenticated
  USING (warehouse_id = public.current_warehouse_id());
DROP POLICY IF EXISTS categories_write ON public.categories;
CREATE POLICY categories_write ON public.categories
  FOR ALL TO authenticated
  USING (public.is_warehouse() AND warehouse_id = auth.uid())
  WITH CHECK (public.is_warehouse() AND warehouse_id = auth.uid());

-- product_variants：可见性 / 写入 都跟随父商品的归属
DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_variants.product_id
      AND p.warehouse_id = public.current_warehouse_id()
  ));
DROP POLICY IF EXISTS product_variants_write ON public.product_variants;
CREATE POLICY product_variants_write ON public.product_variants
  FOR ALL TO authenticated
  USING (public.is_warehouse() AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_variants.product_id AND p.warehouse_id = auth.uid()
  ))
  WITH CHECK (public.is_warehouse() AND EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_variants.product_id AND p.warehouse_id = auth.uid()
  ));

-- orders：门店看自己的；老板看自己名下的
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (store_id = auth.uid() OR (public.is_warehouse() AND warehouse_id = auth.uid()));
DROP POLICY IF EXISTS orders_update_warehouse ON public.orders;
CREATE POLICY orders_update_warehouse ON public.orders
  FOR UPDATE TO authenticated
  USING (public.is_warehouse() AND warehouse_id = auth.uid())
  WITH CHECK (public.is_warehouse() AND warehouse_id = auth.uid());

-- order_items：可见性跟随父订单
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (o.store_id = auth.uid() OR (public.is_warehouse() AND o.warehouse_id = auth.uid()))
  ));


-- ───────────────────────────────────────────────
-- 6. 新用户触发器：从 user_metadata 读取 warehouse_id / store_name
--    老板在后台「创建门店账号」时会带上这些 metadata；role 一律默认 store。
--    你在 Supabase 手动新建老板后，请手动执行：
--        UPDATE public.profiles SET role = 'warehouse' WHERE id = '<老板的 user id>';
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, warehouse_id, store_name)
  VALUES (
    NEW.id,
    'store',
    NULLIF(NEW.raw_user_meta_data->>'warehouse_id', '')::uuid,
    NULLIF(NEW.raw_user_meta_data->>'store_name', '')
  );
  RETURN NEW;
END;
$$;


-- ───────────────────────────────────────────────
-- 7. place_order：订单写入所属老板 warehouse_id；并校验商品属于本仓库（防跨租户下单）
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_item     jsonb;
  v_prod_id  uuid;
  v_var_id   uuid;
  v_qty      int;
  v_stock    int;
  v_price    numeric;
  v_wh       uuid;
BEGIN
  -- 只有门店可下单；同时取出其所属老板
  SELECT warehouse_id INTO v_wh FROM profiles WHERE id = auth.uid() AND role = 'store';
  IF v_wh IS NULL THEN RAISE EXCEPTION '无权限或门店未关联仓库'; END IF;

  INSERT INTO orders (store_id, warehouse_id, status)
  VALUES (auth.uid(), v_wh, 'pending')
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty     := (v_item->>'quantity')::int;
    v_var_id  := CASE
      WHEN (v_item->>'variant_id') IS NOT NULL THEN (v_item->>'variant_id')::uuid
      ELSE NULL
    END;

    -- 商品必须属于本门店所属的仓库
    SELECT price INTO v_price FROM products WHERE id = v_prod_id AND warehouse_id = v_wh;
    IF v_price IS NULL THEN RAISE EXCEPTION '商品不存在或不属于本仓库'; END IF;

    IF v_var_id IS NOT NULL THEN
      SELECT stock INTO v_stock FROM product_variants WHERE id = v_var_id FOR UPDATE;
      IF v_stock IS NULL THEN RAISE EXCEPTION '颜色变体不存在'; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION '颜色变体库存不足'; END IF;
      UPDATE product_variants SET stock = stock - v_qty WHERE id = v_var_id;
    ELSE
      SELECT stock INTO v_stock FROM products WHERE id = v_prod_id FOR UPDATE;
      IF v_stock IS NULL THEN RAISE EXCEPTION '商品不存在'; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION '商品库存不足'; END IF;
      UPDATE products SET stock = stock - v_qty WHERE id = v_prod_id;
    END IF;

    INSERT INTO order_items (order_id, product_id, variant_id, quantity, unit_price)
    VALUES (v_order_id, v_prod_id, v_var_id, v_qty, v_price);
  END LOOP;

  RETURN v_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb) TO authenticated;


-- ───────────────────────────────────────────────
-- 8. get_store_users：只返回「当前老板名下」的门店（原本返回全部门店）
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_users()
RETURNS TABLE (id uuid, email text, store_name text, role text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, u.email::text, p.store_name, p.role::text, p.created_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'store'
    AND p.warehouse_id = auth.uid()
    AND public.is_warehouse();
$$;
GRANT EXECUTE ON FUNCTION public.get_store_users() TO authenticated;


-- ───────────────────────────────────────────────
-- 9. delete_order：加「订单属于本仓库」校验（防跨租户删单）
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_wh     uuid;
BEGIN
  IF NOT public.is_warehouse() THEN RAISE EXCEPTION '无权删除订单'; END IF;

  SELECT status, warehouse_id INTO v_status, v_wh FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_wh IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '订单不属于本仓库'; END IF;
  IF v_status NOT IN ('done', 'cancelled') THEN
    RAISE EXCEPTION '只有已完成或已取消的订单可以删除';
  END IF;

  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_order(uuid) TO authenticated;
