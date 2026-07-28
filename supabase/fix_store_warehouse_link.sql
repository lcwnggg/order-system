-- ═══════════════════════════════════════════════════════════════
-- 修复：把所有门店挂到 movilspa@gmail.com（真正在用的老板账号）名下
--
-- 背景：7 家门店的 warehouse_id 指向 luciawang815@gmail.com，
--       但商品/订单都在 movilspa@gmail.com 下 → 仓库端看板查不到任何门店。
--
-- 用法：整个文件复制到 Supabase SQL Editor 跑一次。
--       最后会显示一张结果表，确认「门店数」变成 7。
--
-- ⚠️ 这个脚本会【修改数据】（只改 profiles.warehouse_id 这一列，不动商品/订单）。
--    想撤销的话，见文件最下方的「回滚」注释。
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 1. 把所有门店改挂到 movilspa 名下
--    （包含目前挂在 luciawang815 下的，以及任何没挂到老板的孤儿门店）
-- ───────────────────────────────────────────────
UPDATE public.profiles s
SET warehouse_id = (
  SELECT p.id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = 'movilspa@gmail.com'
    AND p.role = 'warehouse'
)
WHERE s.role = 'store';


-- ───────────────────────────────────────────────
-- 2. 验证：跑完这一条会显示结果。
--    movilspa 那一行的「门店数」应该变成 7，luciawang815 变成 0。
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


-- ═══════════════════════════════════════════════════════════════
-- 回滚（万一改错了，想把门店改回 luciawang815 名下，跑这段）：
--
--   UPDATE public.profiles s
--   SET warehouse_id = (
--     SELECT p.id FROM public.profiles p
--     JOIN auth.users u ON u.id = p.id
--     WHERE u.email = 'luciawang815@gmail.com' AND p.role = 'warehouse'
--   )
--   WHERE s.role = 'store';
-- ═══════════════════════════════════════════════════════════════
