-- ═══════════════════════════════════════════════════════════════
-- 诊断：两个「老板(warehouse)」账号，各自名下都有些什么？
--
-- 用法：整个文件复制到 Supabase SQL Editor 跑一次，把结果截图发出来。
--       只读查询，不改任何数据。
--
-- ⚠️ 注意：Supabase SQL Editor 只显示【最后一条】查询的结果，
--    所以这里特意只写一条查询，一张表看全。
--
-- 怎么看：哪个邮箱那一行的「商品数 / 订单数」不是 0，
--        哪个就是你真正在用的老板账号。门店应该挂在同一个账号下。
-- ═══════════════════════════════════════════════════════════════

SELECT
  u.email                                                                    AS 老板邮箱,
  w.id                                                                       AS 老板id,
  (SELECT count(*) FROM public.profiles   s WHERE s.role = 'store'
                                            AND s.warehouse_id = w.id)       AS 门店数,
  (SELECT count(*) FROM public.products   p WHERE p.warehouse_id = w.id)     AS 商品数,
  (SELECT count(*) FROM public.categories c WHERE c.warehouse_id = w.id)     AS 分类数,
  (SELECT count(*) FROM public.orders     o WHERE o.warehouse_id = w.id)     AS 订单数
FROM public.profiles w
LEFT JOIN auth.users u ON u.id = w.id
WHERE w.role = 'warehouse'
ORDER BY u.email;
