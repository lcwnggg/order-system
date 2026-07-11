-- 订单取消（回补库存）+ 下单备注
-- 请在 Supabase Dashboard → SQL Editor 中执行此脚本
-- 幂等：可重复执行，不会报错

-- ─────────────────────────────────────────────
-- 1. orders 增加备注字段 note（text，可空）
-- ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS note text;

-- ─────────────────────────────────────────────
-- 2. cancel_order：门店取消 pending 订单，事务内回补库存
--    place_order 的逆操作。SECURITY DEFINER + 手动校验调用者是订单所有者。
--    注意：会把 status 置为 'cancelled'。若你的 orders.status 是带 CHECK
--    约束或 enum 类型的字段、且不含 'cancelled'，执行取消时会报错——
--    届时把报错发我，我再给你补 status 取值的 SQL。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_status   text;
  r          record;
BEGIN
  -- 锁定订单行，读所有者与状态
  SELECT store_id, status INTO v_store_id, v_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF v_store_id <> auth.uid() THEN
    RAISE EXCEPTION '无权取消该订单';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '只有待处理订单可以取消';
  END IF;

  -- 逐条回补库存：有变体回补变体库存，否则回补商品库存
  FOR r IN
    SELECT product_id, variant_id, quantity
    FROM public.order_items
    WHERE order_id = p_order_id
  LOOP
    IF r.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock + r.quantity
      WHERE id = r.variant_id;
    ELSE
      UPDATE public.products
      SET stock = stock + r.quantity
      WHERE id = r.product_id;
    END IF;
  END LOOP;

  UPDATE public.orders
  SET status = 'cancelled'
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;

-- ─────────────────────────────────────────────
-- 3. set_order_note：门店给自己的订单写备注
--    独立函数，避免改动 place_order。SECURITY DEFINER + 所有者校验。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_order_note(p_order_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  SELECT store_id INTO v_store_id
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF v_store_id <> auth.uid() THEN
    RAISE EXCEPTION '无权修改该订单';
  END IF;

  UPDATE public.orders
  SET note = NULLIF(btrim(p_note), '')
  WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_order_note(uuid, text) TO authenticated;
