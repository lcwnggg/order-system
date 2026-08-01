-- ══════════════════════════════════════════════════════════════
-- Coste de compra de cada línea de pedido, PRIVADO (solo el almacén dueño)
-- ══════════════════════════════════════════════════════════════
--
-- Para qué: en la pantalla de pedidos del almacén se quiere ver, además del
-- importe que paga la tienda, cuánto costó comprar esa mercancía y por tanto
-- cuánto se gana con el pedido. Ese dato no puede salir de `product_costs` en
-- el momento de mirarlo, porque el precio de compra cambia con el tiempo: un
-- pedido de marzo hay que valorarlo con el coste de marzo. Se guarda una foto,
-- igual que ya se hace con `order_items.unit_price` (ver
-- place_order_snapshot_and_get_store_users.sql).
--
-- Por qué una tabla aparte y no una columna `unit_cost` en `order_items`:
--   `order_items` lo lee la tienda (policy de SELECT que sigue al pedido
--   propio) con la anon key desde el navegador. Postgres RLS filtra FILAS, no
--   COLUMNAS: una columna de coste ahí sería legible por el empleado aunque la
--   interfaz no la pinte. Mismo razonamiento que en product_costs.sql.
--
-- Quién la rellena: un trigger sobre `order_items`. La tienda que hace el
-- pedido NO puede leer `product_costs` (su RLS es de solo-almacén), así que el
-- dato tiene que copiarlo el servidor; por eso la función es SECURITY DEFINER.
--
-- Idempotente: se puede ejecutar varias veces sin romper nada.
-- ⚠️ Ejecutar DESPUÉS de product_costs.sql.

-- Por si este script se ejecuta antes que enable_rls.sql
CREATE OR REPLACE FUNCTION public.is_warehouse()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'warehouse'
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_warehouse() TO authenticated;

CREATE TABLE IF NOT EXISTS public.order_item_costs (
  order_item_id uuid PRIMARY KEY
    REFERENCES public.order_items(id) ON DELETE CASCADE,
  unit_cost     numeric(10, 2),        -- coste unitario EN EL MOMENTO del pedido
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_item_costs ENABLE ROW LEVEL SECURITY;

-- Una sola policy FOR ALL: leer, insertar, actualizar y borrar quedan
-- reservados al ALMACÉN DUEÑO del pedido. No basta con «es rol warehouse»: sin
-- la comprobación de pertenencia, otro dueño de la plataforma podría leer los
-- costes de este.
DROP POLICY IF EXISTS order_item_costs_warehouse_only ON public.order_item_costs;
CREATE POLICY order_item_costs_warehouse_only ON public.order_item_costs
  FOR ALL TO authenticated
  USING (
    public.is_warehouse() AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_costs.order_item_id
        AND o.warehouse_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_warehouse() AND EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_costs.order_item_id
        AND o.warehouse_id = auth.uid()
    )
  );

-- ── La foto del coste, al insertar la línea ──
-- AFTER INSERT (no BEFORE) porque hace falta el `id` ya asignado de la línea.
-- Si el producto no tiene precio de compra apuntado, no se escribe fila: así
-- «no lo sé» se distingue de «me costó 0», y la interfaz puede avisar de que
-- ese pedido tiene líneas sin valorar en vez de dar una ganancia inflada.
CREATE OR REPLACE FUNCTION public.snapshot_order_item_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost numeric;
BEGIN
  SELECT cost_price INTO v_cost
  FROM public.product_costs
  WHERE product_id = NEW.product_id;

  IF v_cost IS NOT NULL THEN
    INSERT INTO public.order_item_costs (order_item_id, unit_cost)
    VALUES (NEW.id, v_cost)
    ON CONFLICT (order_item_id) DO UPDATE SET unit_cost = EXCLUDED.unit_cost;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_snapshot_cost ON public.order_items;
CREATE TRIGGER order_items_snapshot_cost
  AFTER INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_order_item_cost();

-- ── Relleno de los pedidos anteriores a este script ──
-- No hay foto histórica que recuperar, así que se usa el coste actual: es una
-- aproximación, pero deja los pedidos ya existentes con cifras utilizables.
-- ON CONFLICT DO NOTHING para que una segunda ejecución no pise las fotos
-- buenas que ya haya escrito el trigger.
INSERT INTO public.order_item_costs (order_item_id, unit_cost)
SELECT oi.id, pc.cost_price
FROM public.order_items oi
JOIN public.product_costs pc ON pc.product_id = oi.product_id
WHERE pc.cost_price IS NOT NULL
ON CONFLICT (order_item_id) DO NOTHING;

-- ── Comprobación ──
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public' AND tablename='order_item_costs';   -- true
--   SELECT count(*) FROM public.order_item_costs;
