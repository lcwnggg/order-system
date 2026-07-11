-- 数据完整性 + 原子库存（审计 #2/#3/#5/#6/#7）
-- 请在 Supabase Dashboard → SQL Editor 中执行
-- 幂等：可重复执行，不会报错

-- ─────────────────────────────────────────────
-- #2 订单行价格快照：order_items.unit_price
--    下单当时的单价，历史金额从此固化，不再随 products.price 变动。
--    旧行用「当前商品价」回填（历史真实成交价已无从考证，这是唯一可得的近似；
--    从现在起新订单会由 place_order 写入真实成交价——见文件末尾说明）。
-- ─────────────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_price numeric;

UPDATE public.order_items oi
SET unit_price = p.price
FROM public.products p
WHERE oi.product_id = p.id
  AND oi.unit_price IS NULL;

-- ─────────────────────────────────────────────
-- #5 status 取值约束（挡住 'preparing ' 之类的错别字）
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_status_check
      CHECK (status IN ('pending', 'preparing', 'done', 'cancelled'));
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- #3 库存非负约束（最后一道防线，任何代码 bug 都无法把库存写成负数）
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_nonneg') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_stock_nonneg CHECK (stock >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_stock_nonneg') THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_stock_nonneg CHECK (stock >= 0);
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- #6 常用查询的索引
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS orders_store_id_idx        ON public.orders (store_id);
CREATE INDEX IF NOT EXISTS orders_status_idx          ON public.orders (status);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx   ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_id_idx ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS order_items_variant_id_idx ON public.order_items (variant_id);
CREATE INDEX IF NOT EXISTS products_category_id_idx   ON public.products (category_id);
CREATE INDEX IF NOT EXISTS product_variants_product_id_idx ON public.product_variants (product_id);

-- ─────────────────────────────────────────────
-- #7 补外键 order_items.variant_id → product_variants.id
--    仅当没有孤儿行且约束尚不存在时才加（有孤儿行会自动跳过、不报错；
--    若被跳过，先清理孤儿 order_items 再重跑本段）。
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_fkey')
     AND NOT EXISTS (
       SELECT 1 FROM public.order_items oi
       WHERE oi.variant_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.id = oi.variant_id)
     )
  THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_variant_id_fkey
      FOREIGN KEY (variant_id) REFERENCES public.product_variants (id);
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- #3 原子库存自增 RPC（消除应用层「读-改-写」竞态 / lost update）
--    仓库端补货走这两个函数，一条 UPDATE 内完成 stock = stock + delta。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_product_stock(p_id uuid, p_delta int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'warehouse') THEN
    RAISE EXCEPTION '无权限';
  END IF;
  UPDATE public.products SET stock = stock + p_delta WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_variant_stock(p_id uuid, p_delta int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'warehouse') THEN
    RAISE EXCEPTION '无权限';
  END IF;
  UPDATE public.product_variants SET stock = stock + p_delta WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_variant_stock(uuid, int) TO authenticated;

-- ─────────────────────────────────────────────
-- ⚠️ 还需你手动做一件事（#2 收尾）：让 place_order 写入 unit_price。
--    place_order 的定义不在仓库里，我看不到。请把它现有定义发我（Dashboard →
--    Database → Functions → place_order，或 SQL Editor 里
--    `SELECT pg_get_functiondef('public.place_order'::regproc);`），
--    我据此改成插入 order_items 时把当时的 products.price 写进 unit_price，
--    这样从此往后每笔订单的金额都是当时的真实成交价。
-- ─────────────────────────────────────────────
