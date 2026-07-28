-- ═══════════════════════════════════════════════════════════════
-- 门店互调（inter-store transfer / traspaso entre tiendas）
--   一家门店缺货、仓库也没有时，向【同一老板名下的所有门店】广播「谁有这个货？」。
--   谁点「我有」就接单去备货，发起门店像看普通订单一样追踪状态。
--
--   状态机对齐现有 orders：open(待认领) → claimed(备货中) → done(已交货) / cancelled(撤销)。
--
-- 幂等：可重复执行。
-- ⚠️ 执行顺序：在 multi_tenant.sql 之后执行（依赖 current_warehouse_id() / is_warehouse()）。
-- ⚠️ 生产执行前建议先在 Supabase database branch 上跑一遍。
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 1. 表结构
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transfer_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 归属老板范围：同一 warehouse_id 下的门店互相可见（多租户隔离）
  warehouse_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 发起（缺货）的门店
  requester_store_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 要的货：自由文字 + 可选照片（很特定的东西目录里往往没有）
  item_text          text NOT NULL,
  photo_url          text,
  quantity           int,
  note               text,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'claimed', 'done', 'cancelled')),
  -- 认领（点了「我有」去备货）的门店
  claimed_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_warehouse ON public.transfer_requests(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_requester ON public.transfer_requests(requester_store_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_claimed   ON public.transfer_requests(claimed_by);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_status    ON public.transfer_requests(status);

-- 每家门店对某条请求点「我没有」的记录：只在自己的看板上压掉该卡片，不影响别人。
CREATE TABLE IF NOT EXISTS public.transfer_declines (
  request_id uuid NOT NULL REFERENCES public.transfer_requests(id) ON DELETE CASCADE,
  store_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, store_id)
);


-- ───────────────────────────────────────────────
-- 2. RLS：同一老板范围内可见；写操作一律走下方 SECURITY DEFINER RPC
-- ───────────────────────────────────────────────
ALTER TABLE public.transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_declines ENABLE ROW LEVEL SECURITY;

-- 请求：同一 warehouse 范围内的门店 + 老板都能读（realtime 订阅也依赖此策略过滤行）
DROP POLICY IF EXISTS transfer_requests_select ON public.transfer_requests;
CREATE POLICY transfer_requests_select ON public.transfer_requests
  FOR SELECT TO authenticated
  USING (warehouse_id = public.current_warehouse_id());

-- 「我没有」记录：只读自己的
DROP POLICY IF EXISTS transfer_declines_select ON public.transfer_declines;
CREATE POLICY transfer_declines_select ON public.transfer_declines
  FOR SELECT TO authenticated
  USING (store_id = auth.uid());


-- ───────────────────────────────────────────────
-- 3. RPC：发起互调请求（门店）
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_transfer_request(
  p_item_text text,
  p_photo_url text DEFAULT NULL,
  p_quantity  int  DEFAULT NULL,
  p_note      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wh uuid; v_id uuid;
BEGIN
  SELECT warehouse_id INTO v_wh FROM profiles WHERE id = auth.uid() AND role = 'store';
  IF v_wh IS NULL THEN RAISE EXCEPTION '无权限或门店未关联仓库'; END IF;
  IF COALESCE(btrim(p_item_text), '') = '' THEN RAISE EXCEPTION '请填写要调的货'; END IF;

  INSERT INTO transfer_requests (warehouse_id, requester_store_id, item_text, photo_url, quantity, note)
  VALUES (
    v_wh, auth.uid(), btrim(p_item_text),
    NULLIF(btrim(p_photo_url), ''),
    p_quantity,
    NULLIF(btrim(p_note), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_transfer_request(text, text, int, text) TO authenticated;


-- ───────────────────────────────────────────────
-- 4. RPC：认领「我有」（门店 或 仓库老板）——行锁 + 状态校验，避免同时认领
--    仓库老板万一自己有货也能认领；current_warehouse_id() 对门店/仓库都给出各自「老板范围」。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_transfer_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_scope uuid; r record;
BEGIN
  v_scope := public.current_warehouse_id();
  IF v_scope IS NULL THEN RAISE EXCEPTION '无权限'; END IF;

  SELECT * INTO r FROM transfer_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '请求不存在'; END IF;
  IF r.warehouse_id <> v_scope THEN RAISE EXCEPTION '该请求不属于本仓库分组'; END IF;
  IF r.requester_store_id = auth.uid() THEN RAISE EXCEPTION '不能认领自己发起的请求'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION '该请求已被认领或已结束'; END IF;

  UPDATE transfer_requests
    SET status = 'claimed', claimed_by = auth.uid(), claimed_at = now(), updated_at = now()
    WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_transfer_request(uuid) TO authenticated;


-- ───────────────────────────────────────────────
-- 5. RPC：我没有（门店）——只压掉自己看板上的这张卡片
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decline_transfer_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wh uuid;
BEGIN
  SELECT warehouse_id INTO v_wh FROM profiles WHERE id = auth.uid() AND role = 'store';
  IF v_wh IS NULL THEN RAISE EXCEPTION '无权限'; END IF;

  INSERT INTO transfer_declines (request_id, store_id)
  VALUES (p_id, auth.uid())
  ON CONFLICT DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.decline_transfer_request(uuid) TO authenticated;


-- ───────────────────────────────────────────────
-- 6. RPC：流转状态
--    done      → 只有备货门店(claimed_by)可标记「已交货」
--    open      → 备货门店可「退回」（认领错了）
--    cancelled → 只有发起门店可「撤销」
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_transfer_status(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM transfer_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '请求不存在'; END IF;

  IF p_status = 'done' THEN
    IF r.claimed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '只有备货门店可标记完成'; END IF;
    IF r.status <> 'claimed' THEN RAISE EXCEPTION '当前状态不可标记完成'; END IF;
    UPDATE transfer_requests SET status = 'done', updated_at = now() WHERE id = p_id;

  ELSIF p_status = 'open' THEN
    IF r.claimed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '只有备货门店可退回'; END IF;
    IF r.status <> 'claimed' THEN RAISE EXCEPTION '当前状态不可退回'; END IF;
    UPDATE transfer_requests
      SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = now()
      WHERE id = p_id;

  ELSIF p_status = 'cancelled' THEN
    IF r.requester_store_id <> auth.uid() THEN RAISE EXCEPTION '只有发起门店可撤销'; END IF;
    IF r.status NOT IN ('open', 'claimed') THEN RAISE EXCEPTION '当前状态不可撤销'; END IF;
    UPDATE transfer_requests SET status = 'cancelled', updated_at = now() WHERE id = p_id;

  ELSE
    RAISE EXCEPTION '未知状态：%', p_status;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_transfer_status(uuid, text) TO authenticated;


-- ───────────────────────────────────────────────
-- 7. RPC：看板数据（一次取全）
--    门店之间彼此看不到对方 profile（profiles RLS 只允许看自己），
--    所以用 SECURITY DEFINER 在这里补上「发起门店名 / 备货门店名 / 我是否已回复没有」。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_transfer_board()
RETURNS TABLE (
  id                 uuid,
  requester_store_id uuid,
  requester_name     text,
  item_text          text,
  photo_url          text,
  quantity           int,
  note               text,
  status             text,
  claimed_by         uuid,
  claimer_name       text,
  created_at         timestamptz,
  i_declined         boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT
    t.id,
    t.requester_store_id,
    COALESCE(rp.store_name, ru.email::text) AS requester_name,
    t.item_text,
    t.photo_url,
    t.quantity,
    t.note,
    t.status,
    t.claimed_by,
    CASE WHEN cp.role = 'warehouse' THEN COALESCE(cp.store_name, '仓库')
         ELSE COALESCE(cp.store_name, cu.email::text) END AS claimer_name,
    t.created_at,
    EXISTS (
      SELECT 1 FROM transfer_declines d
      WHERE d.request_id = t.id AND d.store_id = auth.uid()
    ) AS i_declined
  FROM transfer_requests t
  LEFT JOIN profiles   rp ON rp.id = t.requester_store_id
  LEFT JOIN auth.users ru ON ru.id = t.requester_store_id
  LEFT JOIN profiles   cp ON cp.id = t.claimed_by
  LEFT JOIN auth.users cu ON cu.id = t.claimed_by
  WHERE t.warehouse_id = public.current_warehouse_id()
  ORDER BY t.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_transfer_board() TO authenticated;


-- ───────────────────────────────────────────────
-- 7b. RPC：本组门店名册（画「每家店一个圈」的看板用）
--     门店之间彼此看不到对方 profile，这里用 SECURITY DEFINER 统一返回同一老板名下的所有门店。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_group_stores()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT p.id, COALESCE(p.store_name, u.email::text) AS name
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'store'
    AND p.warehouse_id = public.current_warehouse_id()
  ORDER BY p.created_at NULLS FIRST;
$$;
GRANT EXECUTE ON FUNCTION public.get_group_stores() TO authenticated;


-- ───────────────────────────────────────────────
-- 8. 实时（Supabase Realtime）：把请求表加入发布，前端订阅后无刷新更新
-- ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transfer_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_requests;
  END IF;
END $$;
