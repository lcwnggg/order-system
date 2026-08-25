-- ═══════════════════════════════════════════════════════════════
-- Traspasos viejos que no caducan · diagnóstico y limpieza a mano
--
-- ⚠️ IMPORTANTE sobre el SQL Editor: aquí entras como «postgres», no como
--    una tienda. auth.uid() es NULL, así que sweep_transfer_requests() no
--    sabe de qué grupo de tiendas ocuparse y se sale sin hacer nada —sin
--    error—. Llamarla desde aquí NO demuestra nada; solo funciona desde la
--    web, con una tienda dentro. Por eso el BLOQUE 2 hace la limpieza sin
--    depender de quién esté conectado.
--
-- Ejecuta un bloque cada vez: selecciónalo con el ratón y pulsa ⌘↵.
-- ═══════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────
-- BLOQUE 1 · SOLO LECTURA: por qué sigue ahí cada petición
--   Mira la columna `motivo`. Y mándame la tabla si no queda claro.
-- ───────────────────────────────────────────────
SELECT
  left(t.item_text, 40)              AS articulo,
  t.status,
  t.mode,
  date_trunc('minute', t.created_at) AS creada,
  round(extract(epoch FROM now() - t.updated_at) / 86400, 1)
                                     AS dias_sin_moverse,
  (SELECT count(*) FROM public.transfer_claims c WHERE c.request_id = t.id)
                                     AS apuntados,
  CASE
    WHEN t.status = 'expired' THEN 'ya está devuelta (solo la ve quien la pidió)'
    WHEN t.updated_at >= now() - interval '3 days'
      THEN 'se movió hace menos de 3 días'
    ELSE 'DEBERÍA HABER CADUCADO → el barrido no se está ejecutando'
  END                                AS motivo
FROM public.transfer_requests t
WHERE t.status IN ('open', 'claimed', 'expired')
ORDER BY t.created_at;


-- ───────────────────────────────────────────────
-- BLOQUE 2 · LIMPIEZA A MANO (sí modifica datos)
--   Hace lo mismo que el barrido automático pero para TODAS las tiendas,
--   sin depender de auth.uid(). Devuelve la lista de lo que ha devuelto,
--   así ves exactamente qué ha tocado. Repetirlo no hace daño.
--   Esto es lo que arregla el atasco de las de 14 días.
-- ───────────────────────────────────────────────
UPDATE public.transfer_requests t
SET status = 'expired', expired_at = now()
WHERE t.status IN ('open', 'claimed')
  AND t.updated_at < now() - interval '3 days'
RETURNING left(item_text, 40) AS devuelta, status, created_at;


-- ───────────────────────────────────────────────
-- BLOQUE 3 · SOLO LECTURA: ¿están montadas las piezas?
--   Todo debería salir «true». Si algo sale false, falta ejecutar
--   supabase/transfer_expiry.sql.
-- ───────────────────────────────────────────────
SELECT
  to_regprocedure('public.sweep_transfer_requests()')     IS NOT NULL AS sweep,
  to_regprocedure('public.reopen_transfer_request(uuid)') IS NOT NULL AS reopen,
  to_regprocedure('public.delete_transfer_request(uuid)') IS NOT NULL AS borrar,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transfer_requests'
            AND column_name = 'expired_at')  AS col_expired_at,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transfer_requests'
            AND column_name = 'reopened_at') AS col_reopened_at,
  (SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
    WHERE conrelid = 'public.transfer_requests'::regclass
      AND conname = 'transfer_requests_status_check') AS estados_permitidos;
