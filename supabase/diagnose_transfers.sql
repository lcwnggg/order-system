-- ═══════════════════════════════════════════════════════════════
-- 诊断：门店互调看板显示「还没有其他门店」
--
-- 用法：整个文件复制到 Supabase SQL Editor 跑一次，把结果截图发出来。
--       只读查询，不改任何数据，随便跑。
-- ═══════════════════════════════════════════════════════════════


-- ① 关键函数装好了没？（正常应该是 3 行：current_warehouse_id / get_group_stores / get_transfer_board）
SELECT '① 函数' AS 检查项, proname AS 名称
FROM pg_proc
WHERE proname IN ('current_warehouse_id', 'get_group_stores', 'get_transfer_board')
ORDER BY proname;


-- ② 所有账号一览：谁是仓库老板、谁是门店、门店挂在哪个仓库下
--    ⚠️ 重点看 warehouse_id 那一列：
--       - 门店(store)的 warehouse_id 必须等于 仓库老板(warehouse)的 id
--       - 如果门店的 warehouse_id 是空的(NULL)，或者不等于老板 id → 就是看板空的原因
SELECT
  '② 账号' AS 检查项,
  p.role                AS 角色,
  p.store_name          AS 店名,
  u.email               AS 邮箱,
  p.id                  AS 本账号id,
  p.warehouse_id        AS 挂在哪个老板下,
  CASE
    WHEN p.role = 'warehouse' THEN '← 这是老板本人'
    WHEN p.warehouse_id IS NULL THEN '❌ 没挂到任何老板（看板看不到它）'
    WHEN EXISTS (SELECT 1 FROM public.profiles w WHERE w.id = p.warehouse_id AND w.role = 'warehouse')
      THEN '✅ 正常'
    ELSE '❌ 挂的这个 id 不是老板'
  END                   AS 状态
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.role DESC, p.created_at;


-- ③ 统计：每个老板名下各有几家门店（正常应 ≥1；如果是 0 就对上了）
SELECT
  '③ 统计' AS 检查项,
  w.store_name AS 老板,
  wu.email     AS 老板邮箱,
  (SELECT count(*) FROM public.profiles s
    WHERE s.role = 'store' AND s.warehouse_id = w.id) AS 名下门店数
FROM public.profiles w
LEFT JOIN auth.users wu ON wu.id = w.id
WHERE w.role = 'warehouse';
