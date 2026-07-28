-- ═══════════════════════════════════════════════════════════════
-- 回滚：把门店改回挂在 luciawang815@gmail.com 名下
--
-- 为什么要回滚：
--   luciawang815 名下有 125 个商品 + 4 笔订单（真正的目录）
--   movilspa     名下只有 8 个商品 + 0 笔订单
--   之前误把门店挂到了 movilspa，导致门店只能看到 8 个商品的目录。
--   门店必须和商品目录挂在同一个老板下才正常。
--
-- 用法：整个文件复制到 Supabase SQL Editor 跑一次。
--       跑完看结果表，确认 luciawang815 的「门店数」回到 7。
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 1. 门店改回挂到 luciawang815（有 125 商品 / 4 订单的那个）
-- ───────────────────────────────────────────────
UPDATE public.profiles s
SET warehouse_id = (
  SELECT p.id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = 'luciawang815@gmail.com'
    AND p.role = 'warehouse'
)
WHERE s.role = 'store';


-- ───────────────────────────────────────────────
-- 2. 验证：luciawang815 应该是 门店数=7 / 商品数=125 / 订单数=4
--          movilspa     应该是 门店数=0 / 商品数=8   / 订单数=0
-- ───────────────────────────────────────────────
SELECT
  u.email                                                                AS 老板邮箱,
  (SELECT count(*) FROM public.profiles s WHERE s.role = 'store'
                                            AND s.warehouse_id = w.id)   AS 门店数,
  (SELECT count(*) FROM public.products p WHERE p.warehouse_id = w.id)   AS 商品数,
  (SELECT count(*) FROM public.orders   o WHERE o.warehouse_id = w.id)   AS 订单数
FROM public.profiles w
LEFT JOIN auth.users u ON u.id = w.id
WHERE w.role = 'warehouse'
ORDER BY u.email;
