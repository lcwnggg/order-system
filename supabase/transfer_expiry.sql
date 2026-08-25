-- ═══════════════════════════════════════════════════════════════
-- 门店互调 · 过期回收（caducidad de traspasos）
--   问题：没人理的互调请求会永远挂在别家门店的看板上，越堆越难看。
--
--   规则：
--     1) 只要【3 天没有任何动静】就收回（updated_at 是「最后一次有人动它」）：
--        没人认领的、被认领了却迟迟不交货的、multi 收集中没人来收尾的，一视同仁。
--        → 自动变 expired：别家门店/老板都看不到了，只回到发起店自己的清单里。
--     2) expired 之后发起店可以「再发一次」(reopen) 或「删掉」(delete)。
--     3) expired 满 7 天还是没人管 → 自己删掉，不留痕。
--
--   没有用 pg_cron：清扫由读看板时顺手做（sweep_transfer_requests），
--   只扫当前老板范围内的行，成本就是两条带索引的语句。
--
-- 幂等：可重复执行。
-- ⚠️ 执行顺序：在 transfer_requests.sql 和 transfer_multi_store.sql 之后执行。
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- 1. 表结构：状态多一个 expired，多记一个 expired_at（7 天倒计时的起点）
-- ───────────────────────────────────────────────
ALTER TABLE public.transfer_requests
  ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- Marca de la última vez que se volvió a preguntar. La usa el avisador del
-- navegador: sin ella, «volver a solicitar» es un UPDATE indistinguible de
-- cualquier otro y las demás tiendas no oirían nada.
ALTER TABLE public.transfer_requests
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

ALTER TABLE public.transfer_requests
  DROP CONSTRAINT IF EXISTS transfer_requests_status_check;
ALTER TABLE public.transfer_requests
  ADD CONSTRAINT transfer_requests_status_check
  CHECK (status IN ('open', 'claimed', 'done', 'cancelled', 'expired'));

-- 清扫用的索引：按老板范围 + 状态过滤
-- El DROP recrea el índice para quien ya ejecutó una versión anterior de este
-- script (llevaba otra columna y «IF NOT EXISTS» no lo rehace).
DROP INDEX IF EXISTS public.idx_transfer_requests_sweep;
CREATE INDEX IF NOT EXISTS idx_transfer_requests_sweep
  ON public.transfer_requests(warehouse_id, status, updated_at);


-- ───────────────────────────────────────────────
-- 2. sweep_transfer_requests：读看板前顺手清扫（幂等，随便调多少次）
--    只动当前老板范围内的行；没有归属（没登录/没关联仓库）就什么都不做。
--
--    「没人回应」= 没有 claimed_by，且 multi 模式下没有任何报名。
--    「我没有」(transfer_declines) 不算回应，也不重置计时：那正是没人有货的情形。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_transfer_requests()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_scope uuid;
BEGIN
  v_scope := public.current_warehouse_id();
  IF v_scope IS NULL THEN RETURN; END IF;

  -- 3 天没有任何动静 → 收回给发起店
  --   updated_at 就是「最后一次有人动它」：发起、再发一次、认领、报名、报名
  --   改动/撤回，全都会刷新它。所以这一条规则同时盖住三种烂尾：
  --     · 没人认领的；
  --     · 有门店点了「我有」却一直不交货的（真实数据里最多的就是这种）；
  --     · multi 收集中、有人报了名但谁都没来收尾的。
  --   「我没有」(transfer_declines) 不动 updated_at，所以不会重置计时——
  --   那正是没人有货的情形。
  --   注意不要在这里改 updated_at，否则 7 天倒计时的判断会被自己搅乱。
  UPDATE public.transfer_requests t
  SET status = 'expired', expired_at = now()
  WHERE t.warehouse_id = v_scope
    AND t.status IN ('open', 'claimed')
    AND t.updated_at < now() - interval '3 days';

  -- 收回后再放 7 天没人管 → 自己消失
  DELETE FROM public.transfer_requests t
  WHERE t.warehouse_id = v_scope
    AND t.status = 'expired'
    AND t.expired_at IS NOT NULL
    AND t.expired_at < now() - interval '7 days';
END;
$$;
GRANT EXECUTE ON FUNCTION public.sweep_transfer_requests() TO authenticated;


-- ───────────────────────────────────────────────
-- 3. reopen_transfer_request：「再发一次」——只有发起店，且只对没成交的
--    （expired / cancelled）。计时归零，连别家点过的「我没有」也一起清掉：
--    是一次全新的询问，不该带着上次的沉默。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_transfer_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.transfer_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '请求不存在'; END IF;
  IF r.warehouse_id <> public.current_warehouse_id() THEN RAISE EXCEPTION '该请求不属于本仓库分组'; END IF;
  IF r.requester_store_id <> auth.uid() THEN RAISE EXCEPTION '只有发起门店可再发一次'; END IF;
  IF r.status NOT IN ('expired', 'cancelled') THEN RAISE EXCEPTION '当前状态不可再发一次'; END IF;

  -- Pregunta nueva: ni los «no tengo» ni los apuntados de la vez anterior
  -- deben seguir pegados. Si aquello se quedó a medias hace dos semanas, esos
  -- apuntes ya no valen nada.
  DELETE FROM public.transfer_declines WHERE request_id = p_id;
  DELETE FROM public.transfer_claims   WHERE request_id = p_id;

  UPDATE public.transfer_requests
  SET status = 'open',
      claimed_by = NULL,
      claimed_at = NULL,
      expired_at = NULL,
      reopened_at = now(),
      updated_at = now()
  WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reopen_transfer_request(uuid) TO authenticated;


-- ───────────────────────────────────────────────
-- 4. delete_transfer_request：发起店把已经结束的请求从自己的清单里删掉。
--    只允许删已经结束的（expired / cancelled / done）：还在找货或别家正在
--    备货的请求要先「撤销」，免得对方在准备一条已经不存在的货。
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_transfer_request(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.transfer_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '请求不存在'; END IF;
  IF r.warehouse_id <> public.current_warehouse_id() THEN RAISE EXCEPTION '该请求不属于本仓库分组'; END IF;
  IF r.requester_store_id <> auth.uid() THEN RAISE EXCEPTION '只有发起门店可删除'; END IF;
  IF r.status NOT IN ('expired', 'cancelled', 'done') THEN RAISE EXCEPTION '进行中的请求要先撤销'; END IF;

  -- claims / declines 都是 ON DELETE CASCADE，跟着一起走
  DELETE FROM public.transfer_requests WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_transfer_request(uuid) TO authenticated;


-- ───────────────────────────────────────────────
-- 5. get_transfer_board：多返回 expired_at，并且【expired 只有发起店看得见】。
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
  expired_at         timestamptz,
  reopened_at        timestamptz,
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
    t.expired_at,
    t.reopened_at,
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
    -- 收回的请求只回到发起店自己的清单，别家门店和老板都不再看到
    AND (t.status <> 'expired' OR t.requester_store_id = auth.uid())
  ORDER BY t.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_transfer_board() TO authenticated;
