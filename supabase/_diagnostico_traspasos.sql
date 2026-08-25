-- ═══════════════════════════════════════════════════════════════
-- SOLO LECTURA · por qué un traspaso viejo sigue en el tablón
--   Ejecútalo en Supabase → SQL Editor y mándame lo que salga.
--   No modifica nada.
-- ═══════════════════════════════════════════════════════════════

-- 1) ¿Están creadas las piezas de la caducidad?
SELECT
  to_regprocedure('public.sweep_transfer_requests()')  IS NOT NULL AS tiene_sweep,
  to_regprocedure('public.reopen_transfer_request(uuid)') IS NOT NULL AS tiene_reopen,
  to_regprocedure('public.delete_transfer_request(uuid)') IS NOT NULL AS tiene_delete,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='transfer_requests'
            AND column_name='expired_at')  AS tiene_expired_at,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='transfer_requests'
            AND column_name='reopened_at') AS tiene_reopened_at,
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='transfer_claims') AS tiene_claims;

-- 2) ¿El estado 'expired' está permitido por el CHECK?
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.transfer_requests'::regclass AND contype = 'c';

-- 3) Cada petición sin terminar y POR QUÉ no ha caducado.
--    «deberia_caducar = true» y todavía en la lista → el barrido no se ejecuta.
SELECT
  left(t.item_text, 40)                                   AS articulo,
  t.status,
  t.mode,
  date_trunc('minute', t.created_at)                      AS creada,
  date_trunc('minute', t.updated_at)                      AS ultimo_movimiento,
  t.reopened_at,
  t.expired_at,
  t.claimed_by IS NOT NULL                                AS alguien_la_cogio,
  (SELECT count(*) FROM public.transfer_claims c WHERE c.request_id = t.id) AS apuntados,
  round(extract(epoch FROM now() - COALESCE(t.reopened_at, t.created_at)) / 86400, 1) AS dias_desde_que_se_pidio,
  (
    t.status = 'open'
    AND t.claimed_by IS NULL
    AND COALESCE(t.reopened_at, t.created_at) < now() - interval '3 days'
    AND NOT EXISTS (SELECT 1 FROM public.transfer_claims c WHERE c.request_id = t.id)
  )                                                       AS deberia_caducar
FROM public.transfer_requests t
WHERE t.status IN ('open', 'claimed', 'expired')
ORDER BY t.created_at;

-- 4) Comprobación final: ejecuta el barrido de verdad para TU cuenta.
--    Si algo está mal montado, aquí saldrá el error en rojo en vez de
--    tragárselo en silencio como hace la web.
--    (Solo afecta a los traspasos de tu propio grupo de tiendas.)
SELECT public.sweep_transfer_requests();
