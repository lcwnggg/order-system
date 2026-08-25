-- 手写下单（Pedidos escritos）
--   门店需要的东西不在商品目录里时（比如「protector completo 16 Pro Max」），
--   直接写一行文字 + 数量，跟着同一张订单一起发给仓库。
--   这些行不碰库存、不算钱：它们只是写给仓库看的清单。
--
-- 请在 Supabase Dashboard → SQL Editor 中执行此脚本。
-- 幂等：可重复执行，不会报错。

-- ─────────────────────────────────────────────
-- 1. 表：order_custom_items（一张订单的「手写行」）
--    ON DELETE CASCADE：delete_order 删掉订单时这些行自动消失。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_custom_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    int  NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_custom_items_order ON public.order_custom_items(order_id);

-- ─────────────────────────────────────────────
-- 2. RLS：可见性完全跟随父订单（门店看自己的、老板看自己名下的）。
--    和 order_items 一样【故意不给】直接写入策略——写入只走下面的 RPC。
-- ─────────────────────────────────────────────
ALTER TABLE public.order_custom_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_custom_items_select ON public.order_custom_items;
CREATE POLICY order_custom_items_select ON public.order_custom_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_custom_items.order_id
        AND (o.store_id = auth.uid() OR (public.is_warehouse() AND o.warehouse_id = auth.uid()))
    )
  );

-- ─────────────────────────────────────────────
-- 3. add_order_custom_items：把手写行写进一张订单。
--    SECURITY DEFINER + 手动校验：必须是本人的订单，且还没被处理完
--    （pending / preparing 才允许追加）。
--    p_items 形如 [{"description":"protector completo 16 pro max","quantity":5}, ...]
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_order_custom_items(p_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_status   text;
  v_item     jsonb;
  v_desc     text;
  v_qty      int;
BEGIN
  SELECT store_id, status INTO v_store_id, v_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF v_store_id <> auth.uid() THEN
    RAISE EXCEPTION '无权限';
  END IF;

  IF v_status NOT IN ('pending', 'preparing') THEN
    RAISE EXCEPTION '该订单已无法修改';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_desc := btrim(v_item->>'description');
    v_qty  := COALESCE((v_item->>'quantity')::int, 1);

    CONTINUE WHEN v_desc IS NULL OR v_desc = '';
    IF v_qty < 1 THEN v_qty := 1; END IF;
    -- 描述截断到 200 字：它是给人看的一行字，不是自由文本仓库
    v_desc := left(v_desc, 200);

    INSERT INTO public.order_custom_items (order_id, description, quantity)
    VALUES (p_order_id, v_desc, v_qty);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_order_custom_items(uuid, jsonb) TO authenticated;

-- ─────────────────────────────────────────────
-- 4. place_order 允许「只有手写行」的订单（p_items 为空数组）。
--    原函数遇到空数组本来就只是不进循环，这里只是把这件事写清楚：
--    空订单是合法的，因为手写行随后由 add_order_custom_items 补上。
--    （无需改动 place_order 本身。）
-- ─────────────────────────────────────────────
