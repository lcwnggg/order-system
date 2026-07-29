-- Renombrar pedidos + notificaciones push al móvil
-- Ejecutar en Supabase Dashboard → SQL Editor
-- Idempotente: se puede volver a ejecutar sin que dé error.

-- ─────────────────────────────────────────────
-- 1. orders.title — nombre que el almacén le pone al pedido
--    («Reposición sábado», «Urgente Vallecas»…). Opcional: si está
--    vacío, la interfaz sigue mostrando el nombre de la tienda.
--    No hace falta política nueva: orders_update_warehouse ya deja
--    al dueño del almacén actualizar sus propios pedidos.
-- ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS title text;

-- ─────────────────────────────────────────────
-- 2. push_subscriptions — un navegador/móvil suscrito a avisos.
--    Una misma persona puede tener varias (móvil + portátil), por eso
--    la clave es el endpoint, no el usuario.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Cada cual gestiona SOLO sus propias suscripciones. El envío de avisos
-- se hace desde el servidor con la service role key, que se salta RLS:
-- así una tienda nunca puede leer (ni borrar) el endpoint del almacén.
DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
