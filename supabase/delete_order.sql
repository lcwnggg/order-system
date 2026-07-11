-- 删除订单（仅限已完成 / 已取消的订单，仓库端清理用）
-- 请在 Supabase Dashboard → SQL Editor 中执行此脚本
-- 幂等：可重复执行，不会报错

-- delete_order：仓库删除终态订单（done / cancelled）。
-- SECURITY DEFINER + 手动校验调用者是 warehouse。
-- 注意：删除不回补库存 —— done 订单货已出、cancelled 已在取消时回补过，
-- 删除只是清理记录。会连带删除 order_items。
CREATE OR REPLACE FUNCTION public.delete_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text;
  v_status text;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role IS DISTINCT FROM 'warehouse' THEN
    RAISE EXCEPTION '无权删除订单';
  END IF;

  SELECT status INTO v_status
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '订单不存在';
  END IF;

  IF v_status NOT IN ('done', 'cancelled') THEN
    RAISE EXCEPTION '只有已完成或已取消的订单可以删除';
  END IF;

  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_order(uuid) TO authenticated;
