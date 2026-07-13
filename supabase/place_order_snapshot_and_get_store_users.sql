-- place_order 升级（价格快照 + 明确 SECURITY DEFINER + 门店校验）
-- 以及 get_store_users 加仓库校验（堵邮箱泄露 / GDPR）
--
-- ⚠️ 执行顺序：请在 security_integrity.sql 之后跑本脚本
--    （本脚本依赖 order_items.unit_price 列，那一列在 security_integrity.sql 里新增）。
-- 幂等：可重复执行。

-- ─────────────────────────────────────────────
-- place_order：保持原有的逐条 FOR UPDATE 扣库存逻辑不变，新增三点：
--   1. SECURITY DEFINER + SET search_path=public —— 开 RLS 后仍能正常下单，
--      且不会被恶意搜索路径劫持。
--   2. 只有 store 角色能下单（防御性；应用层本来也校验）。
--   3. 写 order_items 时把「下单当时的 products.price」存进 unit_price（价格快照）。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_item     jsonb;
  v_prod_id  uuid;
  v_var_id   uuid;
  v_qty      int;
  v_stock    int;
  v_price    numeric;
BEGIN
  -- 只有门店可下单
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'store') THEN
    RAISE EXCEPTION '无权限';
  END IF;

  INSERT INTO orders (store_id, status)
  VALUES (auth.uid(), 'pending')
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty     := (v_item->>'quantity')::int;
    v_var_id  := CASE
      WHEN (v_item->>'variant_id') IS NOT NULL
        THEN (v_item->>'variant_id')::uuid
      ELSE NULL
    END;

    -- 价格快照：下单当时的商品单价（变体商品价格也在 products 上）
    SELECT price INTO v_price FROM products WHERE id = v_prod_id;
    IF v_price IS NULL THEN RAISE EXCEPTION '商品不存在'; END IF;

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

-- ─────────────────────────────────────────────
-- get_store_users：只有仓库能调用，否则返回 0 行 —— 堵住「任何登录用户拉全部
-- 门店邮箱」的泄露。保持原返回结构（id, email, store_name, role, created_at）。
--
-- ⚠️ 如果执行这段报错 "cannot change return type of existing function"，
--    说明我猜的返回列类型和你现有的不完全一致（比如 role 是枚举而非 text）。
--    把报错原样发我，我按你的真实签名改一版。原函数不会被破坏。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_users()
RETURNS TABLE (id uuid, email text, store_name text, role text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, u.email::text, p.store_name, p.role, p.created_at
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'store'
    AND EXISTS (
      SELECT 1 FROM profiles w WHERE w.id = auth.uid() AND w.role = 'warehouse'
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_store_users() TO authenticated;
