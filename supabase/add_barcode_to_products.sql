-- 给 products 表增加条码字段 barcode + 非唯一索引
-- 请在 Supabase Dashboard → SQL Editor 中执行此脚本
-- 幂等：可重复执行，不会报错

-- 1. 增加 barcode 字段（text，可空）
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text;

-- 2. 非唯一索引，供以后按条码查商品
--    注意：故意不加 UNIQUE 约束 —— 同一条码被不同客户录入是正常的，
--    唯一性留到第二版再讨论。
CREATE INDEX IF NOT EXISTS products_barcode_idx
  ON public.products (barcode);
