-- ═══════════════════════════════════════════════════════════════
-- 门店互调 · 「多店收集」模式（pedir a varias tiendas a la vez）
--   原有模式：一条请求只由第一个点「我有」的门店独占认领（single）。
--   新增模式：想把【所有门店手上有的】都收上来（multi），
--             例如「这个型号的壳，别家有多少我都要」。
--             → 请求保持 open，任何门店都能「我有 N 件」报名，互不抢占；
--               发起店看到一份「谁有几件」的清单，收齐后自己「结束」。
--
--   状态：single 沿用 open → claimed → done/cancelled；
--         multi  为 open（收集中）→ done（发起店结束）/ cancelled，
--                每家门店自己的那一份在 transfer_claims.status 里走 claimed → done。
--
-- 幂等：可重复执行。
-- ⚠️ 执行顺序：在 transfer_requests.sql 之后执行。
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 1. 表结构
-- ───────────────────────────────────────────────
ALTER TABLE public.transfer_requests
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'single';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transfer_requests_mode_check'
  ) THEN
    ALTER TABLE public.transfer_requests
      ADD CONSTRAINT transfer_requests_mode_check CHECK (mode IN ('single', 'multi'));
  END IF;
END $$;

-- multi 模式下每家门店报名的那一份（single 模式仍用 transfer_requests.claimed_by）
CREATE TABLE IF NOT EXISTS public.transfer_claims (
  request_id uuid NOT NULL REFERENCES public.transfer_requests(id) ON DELETE CASCADE,
  store_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quantity   int,                       -- 这家店能给几件；NULL = 没写数量
  status     text NOT NULL DEFAULT 'claimed'
               CHECK (status IN ('claimed', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_claims_store ON public.transfer_claims(store_id);


-- ───────────────────────────────────────────────
-- 2. RLS：同一老板范围内可见；写操作一律走下方 SECURITY DEFINER RPC
-- ───────────────────────────────────────────────
ALTER TABLE public.transfer_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transfer_claims_select ON public.transfer_claims;
CREATE POLICY transfer_claims_select ON public.transfer_claims
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.transfer_requests t
      WHERE t.id = request_id AND t.warehouse_id = public.current_warehouse_id()
    )
  );


-- ───────────────────────────────────────────────
-- 3. RPC：发起互调请求（门店）—— 多一个 p_mode
--    旧签名要先删掉，否则新旧重载并存、少传参数时调用有歧义。
-- ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_transfer_request(text, text, int, text);

CREATE OR REPLACE FUNCTION public.create_transfer_request(
  p_item_text text,
  p_photo_url text DEFAULT NULL,
  p_quantity  int  DEFAULT NULL,
  p_note      text DEFAULT NULL,
  p_mode      text DEFAULT 'single'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wh uuid; v_id uuid; v_mode text;
BEGIN
  SELECT warehouse_id INTO v_wh FROM profiles WHERE id = auth.uid() AND role = 'store';
  IF v_wh IS NULL THEN RAISE EXCEPTION '无权限或门店未关联仓库'; END IF;
  IF COALESCE(btrim(p_item_text), '') = '' THEN RAISE EXCEPTION '请填写要调的货'; END IF;

  v_mode := CASE WHEN p_mode = 'multi' THEN 'multi' ELSE 'single' END;

  INSERT INTO transfer_requests (warehouse_id, requester_store_id, item_text, photo_url, quantity, note, mode)
  VALUES (
    v_wh, auth.uid(), btrim(p_item_text),
    NULLIF(btrim(p_photo_url), ''),
    p_quantity,
    NULLIF(btrim(p_note), ''),
    v_mode
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_transfer_request(text, text, int, text, text) TO authenticated;


-- ───────────────────────────────────────────────
-- 4. RPC：认领「我有」——single 独占认领；multi 记一笔报名，请求继续开放
--    旧签名（uuid）同样先删，避免默认参数造成的重载歧义。
-- ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.claim_transfer_request(uuid);

CREATE OR REPLACE FUNCTION public.claim_transfer_request(
  p_id       uuid,
  p_quantity int DEFAULT NULL
)
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

  IF r.mode = 'multi' THEN
    -- 收集模式：谁都能报名，报名不改请求状态（别家还能继续报）
    IF r.status <> 'open' THEN RAISE EXCEPTION '该请求已结束'; END IF;
    INSERT INTO transfer_claims (request_id, store_id, quantity)
    VALUES (p_id, auth.uid(), p_quantity)
    ON CONFLICT (request_id, store_id) DO UPDATE
      SET quantity = EXCLUDED.quantity, status = 'claimed', updated_at = now();
    -- 报名了就不再显示「我没有」的压卡
    DELETE FROM transfer_declines WHERE request_id = p_id AND store_id = auth.uid();
    UPDATE transfer_requests SET updated_at = now() WHERE id = p_id;

  ELSE
    IF r.status <> 'open' THEN RAISE EXCEPTION '该请求已被认领或已结束'; END IF;
    UPDATE transfer_requests
      SET status = 'claimed', claimed_by = auth.uid(), claimed_at = now(), updated_at = now()
      WHERE id = p_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_transfer_request(uuid, int) TO authenticated;


-- ───────────────────────────────────────────────
-- 5. RPC（multi）：管理自己报的那一份
--    done     → 我这份已交货
--    claimed  → 交货标错了，退回「备货中」
--    withdraw → 撤回报名（其实没货 / 卖掉了）
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_transfer_claim(
  p_id     uuid,
  p_action text,
  p_quantity int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; c record;
BEGIN
  SELECT * INTO r FROM transfer_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '请求不存在'; END IF;
  IF r.warehouse_id <> public.current_warehouse_id() THEN RAISE EXCEPTION '该请求不属于本仓库分组'; END IF;

  SELECT * INTO c FROM transfer_claims WHERE request_id = p_id AND store_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION '你还没有认领这条请求'; END IF;

  IF p_action = 'withdraw' THEN
    DELETE FROM transfer_claims WHERE request_id = p_id AND store_id = auth.uid();
  ELSIF p_action IN ('done', 'claimed') THEN
    UPDATE transfer_claims
      SET status = p_action,
          quantity = COALESCE(p_quantity, quantity),
          updated_at = now()
      WHERE request_id = p_id AND store_id = auth.uid();
  ELSE
    RAISE EXCEPTION '未知状态：%', p_action;
  END IF;

  -- 让 realtime 也推一下请求行，发起店的清单才会自己刷新
  UPDATE transfer_requests SET updated_at = now() WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_transfer_claim(uuid, text, int) TO authenticated;


-- ───────────────────────────────────────────────
-- 6. RPC：流转状态 —— multi 模式下由发起店「结束」
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
    IF r.mode = 'multi' THEN
      -- 收集模式没有唯一的「备货门店」，收齐与否只有发起店知道
      IF r.requester_store_id <> auth.uid() THEN RAISE EXCEPTION '只有发起门店可结束'; END IF;
      IF r.status <> 'open' THEN RAISE EXCEPTION '当前状态不可标记完成'; END IF;
      UPDATE transfer_claims SET status = 'done', updated_at = now()
        WHERE request_id = p_id AND status = 'claimed';
      UPDATE transfer_requests SET status = 'done', updated_at = now() WHERE id = p_id;
    ELSE
      IF r.claimed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '只有备货门店可标记完成'; END IF;
      IF r.status <> 'claimed' THEN RAISE EXCEPTION '当前状态不可标记完成'; END IF;
      UPDATE transfer_requests SET status = 'done', updated_at = now() WHERE id = p_id;
    END IF;

  ELSIF p_status = 'open' THEN
    IF r.mode = 'multi' THEN RAISE EXCEPTION '当前状态不可退回'; END IF;
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
-- 7. RPC：看板数据 —— 多返回 mode / 报名清单 / 我报的那一份
--    返回类型变了，必须先 DROP。
-- ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_transfer_board();

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
  mode               text,
  claimed_by         uuid,
  claimer_name       text,
  created_at         timestamptz,
  i_declined         boolean,
  claims             jsonb,
  my_claim_status    text,
  my_claim_quantity  int
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
    t.mode,
    t.claimed_by,
    CASE WHEN cp.role = 'warehouse' THEN COALESCE(cp.store_name, '仓库')
         ELSE COALESCE(cp.store_name, cu.email::text) END AS claimer_name,
    t.created_at,
    EXISTS (
      SELECT 1 FROM transfer_declines d
      WHERE d.request_id = t.id AND d.store_id = auth.uid()
    ) AS i_declined,
    COALESCE(
      (
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'store_id', tc.store_id,
                   'store_name',
                     CASE WHEN sp.role = 'warehouse' THEN COALESCE(sp.store_name, '仓库')
                          ELSE COALESCE(sp.store_name, su.email::text) END,
                   'quantity', tc.quantity,
                   'status', tc.status
                 )
                 ORDER BY tc.created_at
               )
        FROM transfer_claims tc
        LEFT JOIN profiles   sp ON sp.id = tc.store_id
        LEFT JOIN auth.users su ON su.id = tc.store_id
        WHERE tc.request_id = t.id
      ),
      '[]'::jsonb
    ) AS claims,
    (SELECT tc.status   FROM transfer_claims tc WHERE tc.request_id = t.id AND tc.store_id = auth.uid()) AS my_claim_status,
    (SELECT tc.quantity FROM transfer_claims tc WHERE tc.request_id = t.id AND tc.store_id = auth.uid()) AS my_claim_quantity
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
-- 8. 实时：报名表也入发布，别家一报名，发起店的清单立刻更新
-- ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transfer_claims'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_claims;
  END IF;
END $$;
