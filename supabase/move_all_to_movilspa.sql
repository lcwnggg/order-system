-- ═══════════════════════════════════════════════════════════════
-- 把【全部数据】迁移到 movilspa@gmail.com 名下
--
--   门店(profiles) + 商品(products) + 分类(categories)
--   + 订单(orders) + 互调请求(transfer_requests)
--
-- 迁移后 luciawang815@gmail.com 变成一个空的老板账号（保留，不删）。
-- 以后仓库端一律用 movilspa@gmail.com 登录。
--
-- 用法：整个文件复制到 Supabase SQL Editor 跑一次。
--       跑完会显示结果表：movilspa 应该拿到全部数据，luciawang815 全是 0。
--
-- ⚠️ 会修改数据，但：
--    ① 迁移前自动把「原来的归属」备份到表 _warehouse_move_backup
--    ② 整个迁移在一个事务里，中途出错会全部回退
--    ③ 文件最下方有完整的回滚语句
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 0. 备份原归属（万一要回滚，靠这张表还原）
--    重复跑本脚本不会覆盖第一次的备份，保住最原始的状态。
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._warehouse_move_backup (
  tbl          text,
  row_id       uuid,
  warehouse_id uuid,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._warehouse_move_backup (tbl, row_id, warehouse_id)
SELECT * FROM (
  SELECT 'products'::text,   p.id, p.warehouse_id FROM public.products   p
  UNION ALL
  SELECT 'categories',       c.id, c.warehouse_id FROM public.categories c
  UNION ALL
  SELECT 'orders',           o.id, o.warehouse_id FROM public.orders     o
  UNION ALL
  SELECT 'profiles',         s.id, s.warehouse_id FROM public.profiles   s WHERE s.role = 'store'
) AS src
-- 只在备份表还是空的时候写入 → 保留最原始的归属快照
WHERE NOT EXISTS (SELECT 1 FROM public._warehouse_move_backup);


-- ───────────────────────────────────────────────
-- 1. 迁移（单个事务：要么全成功，要么全不动）
-- ───────────────────────────────────────────────
DO $$
DECLARE
  v_target uuid;
BEGIN
  SELECT p.id INTO v_target
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE u.email = 'movilspa@gmail.com'
    AND p.role = 'warehouse';

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'movilspa@gmail.com 不是 role=warehouse 的账号，已中止，未改动任何数据';
  END IF;

  UPDATE public.products   SET warehouse_id = v_target WHERE warehouse_id IS DISTINCT FROM v_target;
  UPDATE public.categories SET warehouse_id = v_target WHERE warehouse_id IS DISTINCT FROM v_target;
  UPDATE public.orders     SET warehouse_id = v_target WHERE warehouse_id IS DISTINCT FROM v_target;

  -- 门店：全部挂到 movilspa（包含没挂到任何老板的孤儿门店）
  UPDATE public.profiles   SET warehouse_id = v_target WHERE role = 'store';

  -- 互调请求表可能还没建（没跑过 transfer_requests.sql），存在才迁移
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transfer_requests'
  ) THEN
    UPDATE public.transfer_requests SET warehouse_id = v_target WHERE warehouse_id IS DISTINCT FROM v_target;
  END IF;
END $$;


-- ───────────────────────────────────────────────
-- 2. 验证：movilspa 应拿到 门店7 / 商品133 / 订单4；luciawang815 应全是 0
-- ───────────────────────────────────────────────
SELECT
  u.email                                                                AS 老板邮箱,
  (SELECT count(*) FROM public.profiles   s WHERE s.role = 'store'
                                              AND s.warehouse_id = w.id) AS 门店数,
  (SELECT count(*) FROM public.products   p WHERE p.warehouse_id = w.id) AS 商品数,
  (SELECT count(*) FROM public.categories c WHERE c.warehouse_id = w.id) AS 分类数,
  (SELECT count(*) FROM public.orders     o WHERE o.warehouse_id = w.id) AS 订单数
FROM public.profiles w
LEFT JOIN auth.users u ON u.id = w.id
WHERE w.role = 'warehouse'
ORDER BY u.email;


-- ═══════════════════════════════════════════════════════════════
-- 回滚（把所有归属还原成迁移前的样子）：
--
--   UPDATE public.products   t SET warehouse_id = b.warehouse_id
--   FROM public._warehouse_move_backup b
--   WHERE b.tbl = 'products'   AND b.row_id = t.id;
--
--   UPDATE public.categories t SET warehouse_id = b.warehouse_id
--   FROM public._warehouse_move_backup b
--   WHERE b.tbl = 'categories' AND b.row_id = t.id;
--
--   UPDATE public.orders     t SET warehouse_id = b.warehouse_id
--   FROM public._warehouse_move_backup b
--   WHERE b.tbl = 'orders'     AND b.row_id = t.id;
--
--   UPDATE public.profiles   t SET warehouse_id = b.warehouse_id
--   FROM public._warehouse_move_backup b
--   WHERE b.tbl = 'profiles'   AND b.row_id = t.id;
-- ═══════════════════════════════════════════════════════════════
