-- ══════════════════════════════════════════════════════════════
-- Coste de compra + proveedor, PRIVADO (solo el almacén dueño)
-- ══════════════════════════════════════════════════════════════
--
-- Por qué una tabla aparte y no dos columnas en `products`:
--   `products` tiene una policy de SELECT abierta a todo el mundo dentro del
--   mismo almacén (las tiendas necesitan ver nombre/precio/stock), y el cliente
--   de la tienda hace `select(...)` con la anon key. Postgres RLS filtra FILAS,
--   no COLUMNAS: si el coste viviera en `products`, cualquier empleado podría
--   leerlo desde el navegador aunque la interfaz no lo pinte.
--   Con una tabla propia + RLS de solo-dueño, el empleado recibe 0 filas.
--
-- Multi-tenant: la base es multi-almacén (ver multi_tenant.sql). El coste no
-- lleva su propio `warehouse_id`; hereda el del producto, igual que hace
-- `product_variants`. Así no puede quedar descolgado del producto al que
-- pertenece.
--
-- Idempotente: se puede ejecutar varias veces sin romper nada.
-- ⚠️ Ejecutar DESPUÉS de multi_tenant.sql.

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

CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id  uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price  numeric(10, 2),          -- precio al que YO compro
  supplier    text,                    -- a quién se lo compro
  note        text,                    -- apuntes míos (condiciones, teléfono…)
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- El desplegable de proveedores lista los distintos `supplier` ya usados.
CREATE INDEX IF NOT EXISTS product_costs_supplier_idx
  ON public.product_costs (supplier)
  WHERE supplier IS NOT NULL;

ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

-- Una sola policy FOR ALL: leer, insertar, actualizar y borrar quedan
-- reservados al ALMACÉN DUEÑO del producto. No basta con «es rol warehouse»:
-- sin la comprobación de pertenencia, otro dueño de la plataforma podría leer
-- los precios de compra de este. Mismo patrón que product_variants.
DROP POLICY IF EXISTS product_costs_warehouse_only ON public.product_costs;
CREATE POLICY product_costs_warehouse_only ON public.product_costs
  FOR ALL TO authenticated
  USING (
    public.is_warehouse() AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_costs.product_id AND p.warehouse_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_warehouse() AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_costs.product_id AND p.warehouse_id = auth.uid()
    )
  );

-- `updated_at` automático al modificar.
CREATE OR REPLACE FUNCTION public.touch_product_costs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_costs_touch ON public.product_costs;
CREATE TRIGGER product_costs_touch
  BEFORE UPDATE ON public.product_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_product_costs();

-- ── Comprobación ──
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE schemaname='public' AND tablename='product_costs';  -- rowsecurity = true
