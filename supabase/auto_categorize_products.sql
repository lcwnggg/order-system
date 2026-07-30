-- ══════════════════════════════════════════════════════════════
-- Árbol de categorías de la tienda + clasificación automática
-- ══════════════════════════════════════════════════════════════
--
-- Qué hace:
--   1) Crea (si no existen ya, por nombre) las categorías principales y sus
--      subcategorías de una tienda de móviles.
--   2) Asigna una subcategoría a cada producto SIN categoría, adivinándola por
--      palabras clave del nombre, la marca y la descripción.
--
-- Multi-tenant (ver multi_tenant.sql): `categories.warehouse_id` es NOT NULL y
-- normalmente lo rellena el trigger `set_owner_categories` a partir de
-- `auth.uid()`. Pero en el SQL Editor no hay sesión de usuario: `auth.uid()` es
-- NULL y el INSERT reventaría con «null value in column warehouse_id». Por eso
-- aquí el almacén se deduce de los propios productos: se trabaja, uno por uno,
-- sobre cada almacén que tenga productos, y cada producto solo puede acabar en
-- una categoría de SU almacén.
--
-- Reglas de convivencia con lo que ya tienes:
--   · Nunca duplica una categoría que ya exista con ese mismo nombre.
--   · Por defecto SOLO toca productos con `category_id IS NULL`; lo que ya
--     clasificaste a mano se queda como está. Al final hay un bloque comentado
--     para reclasificarlo TODO desde cero si prefieres eso.
--
-- Idempotente: ejecútalo las veces que quieras (p. ej. tras cargar productos
-- nuevos) y solo rellenará los huecos.

-- ─────────────────────────────────────────────
-- 0. Ayudante: quitar acentos sin depender de la extensión `unaccent`
--    (así «batería» y «bateria» se buscan igual)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unaccent_safe(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(
    coalesce(t, ''),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
  );
$$;

-- ─────────────────────────────────────────────
-- 1. Categorías principales — una copia para cada almacén con productos
-- ─────────────────────────────────────────────
INSERT INTO public.categories (name, parent_id, sort_order, warehouse_id)
SELECT v.name, NULL, v.sort_order, w.warehouse_id
FROM (VALUES
  ('Móviles y tablets',       10),
  ('Fundas y protección',     20),
  ('Carga y cables',          30),
  ('Audio',                   40),
  ('Accesorios',              50),
  ('Repuestos y reparación',  60),
  ('Informática',             70),
  ('Otros',                   80)
) AS v(name, sort_order)
CROSS JOIN (
  SELECT DISTINCT warehouse_id FROM public.products WHERE warehouse_id IS NOT NULL
) AS w
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c
  WHERE c.warehouse_id = w.warehouse_id
    AND c.parent_id IS NULL
    AND lower(c.name) = lower(v.name)
);

-- ─────────────────────────────────────────────
-- 2. Subcategorías — cuelgan del padre, y heredan su almacén
-- ─────────────────────────────────────────────
INSERT INTO public.categories (name, parent_id, sort_order, warehouse_id)
SELECT v.name, p.id, v.sort_order, p.warehouse_id
FROM (VALUES
  ('Móviles y tablets',      'Smartphones',              10),
  ('Móviles y tablets',      'Tablets',                  20),
  ('Móviles y tablets',      'Smartwatch',               30),
  ('Móviles y tablets',      'Móviles básicos',          40),

  ('Fundas y protección',    'Fundas',                   10),
  ('Fundas y protección',    'Protectores de pantalla',  20),

  ('Carga y cables',         'Cargadores',               10),
  ('Carga y cables',         'Cables',                   20),
  ('Carga y cables',         'Baterías externas',        30),
  ('Carga y cables',         'Carga inalámbrica',        40),
  ('Carga y cables',         'Cargador de coche',        50),

  ('Audio',                  'Auriculares con cable',    10),
  ('Audio',                  'Auriculares Bluetooth',    20),
  ('Audio',                  'Altavoces',                30),

  ('Accesorios',             'Soportes y trípodes',      10),
  ('Accesorios',             'Adaptadores',              20),
  ('Accesorios',             'Memoria y almacenamiento', 30),
  ('Accesorios',             'Otros accesorios',         40),

  ('Repuestos y reparación', 'Pantallas',                10),
  ('Repuestos y reparación', 'Baterías',                 20),
  ('Repuestos y reparación', 'Herramientas',             30),

  ('Informática',            'Ratón y teclado',          10),
  ('Informática',            'USB y hubs',               20)
) AS v(parent_name, name, sort_order)
JOIN public.categories p
  ON p.parent_id IS NULL AND lower(p.name) = lower(v.parent_name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c
  WHERE c.parent_id = p.id AND lower(c.name) = lower(v.name)
);

-- ─────────────────────────────────────────────
-- 3. Clasificación automática de los productos sin categoría
--
--    `prio` decide qué regla gana cuando un producto encaja en varias:
--    gana el número más bajo. Por eso los accesorios van ANTES que las marcas
--    de móvil: «Funda iPhone 15» es una funda, no un smartphone.
-- ─────────────────────────────────────────────
WITH rules(prio, pattern, cat_name) AS (VALUES
  -- Fundas y protección
  ( 10, '(funda|carcasa|case|cover|bumper)',                                  'Fundas'),
  ( 11, '(cristal templado|templado|protector de pantalla|protector pantalla|screen protector|mica|hidrogel)',
                                                                              'Protectores de pantalla'),

  -- Carga (lo específico primero)
  ( 20, '(inal[áa]mbric|wireless charg|magsafe|qi )',                         'Carga inalámbrica'),
  ( 21, '(coche|mechero|car charger|veh[íi]culo)',                            'Cargador de coche'),
  ( 22, '(power ?bank|bater[íi]a externa|powerbank)',                         'Baterías externas'),
  ( 23, '(cable|usb-?c|lightning|micro ?usb|latiguillo)',                     'Cables'),
  ( 24, '(cargador|charger|adaptador de corriente|transformador|enchufe)',    'Cargadores'),

  -- Audio
  ( 30, '(bluetooth|inal[áa]mbric).*(auricular|casco|earbud|airpod)',         'Auriculares Bluetooth'),
  ( 31, '(auricular|casco|earbud|airpod|headphone|earphone).*(bluetooth|inal[áa]mbric|tws)',
                                                                              'Auriculares Bluetooth'),
  ( 32, '(airpod|tws)',                                                       'Auriculares Bluetooth'),
  ( 33, '(auricular|casco|earphone|headphone|earbud)',                        'Auriculares con cable'),
  ( 34, '(altavoz|altavoces|speaker|bafle|barra de sonido)',                  'Altavoces'),

  -- Accesorios
  ( 40, '(soporte|tr[íi]pode|tripod|palo selfie|selfie stick|holder|stand|pinza)',
                                                                              'Soportes y trípodes'),
  ( 41, '(tarjeta (de )?memoria|micro ?sd|sd card|pendrive|pen drive|memoria usb|usb stick)',
                                                                              'Memoria y almacenamiento'),
  ( 42, '(adaptador|hub|conversor|otg|jack 3)',                               'Adaptadores'),
  ( 43, '(popsocket|anillo|correa|strap|lanyard|colgante|cord[óo]n)',         'Otros accesorios'),

  -- Repuestos
  ( 50, '(pantalla|display|lcd|t[áa]ctil|touch)',                             'Pantallas'),
  ( 51, '(bater[íi]a|battery|pila)',                                          'Baterías'),
  ( 52, '(herramienta|destornillador|kit de reparaci[óo]n|ventosa|spudger|pinzas)',
                                                                              'Herramientas'),

  -- Informática
  ( 60, '(rat[óo]n|mouse|teclado|keyboard|alfombrilla)',                      'Ratón y teclado'),
  ( 61, '(hub usb|usb hub|regleta usb|docking)',                              'USB y hubs'),

  -- Dispositivos (al final: son los que más falsos positivos generan)
  ( 70, '(smartwatch|smart watch|reloj inteligente|pulsera de actividad|band \d)',
                                                                              'Smartwatch'),
  ( 71, '(tablet|ipad|tab \d)',                                               'Tablets'),
  ( 72, '(m[óo]vil b[áa]sico|tel[ée]fono fijo|tecla grande|senior)',          'Móviles básicos'),
  ( 73, '(iphone|galaxy|redmi|poco |xiaomi|samsung|realme|oppo|vivo |honor|huawei|motorola|nokia|tcl|zte|alcatel)',
                                                                              'Smartphones')
),
-- Texto sobre el que buscamos: nombre + marca + descripción, sin acentos ni mayúsculas.
haystack AS (
  SELECT
    p.id,
    p.warehouse_id,
    lower(public.unaccent_safe(
      coalesce(p.name, '') || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.description, '')
    )) AS txt
  FROM public.products p
  WHERE p.category_id IS NULL
),
best AS (
  SELECT DISTINCT ON (h.id)
    h.id           AS product_id,
    h.warehouse_id AS warehouse_id,
    r.cat_name     AS cat_name
  FROM haystack h
  JOIN rules r ON h.txt ~ lower(public.unaccent_safe(r.pattern))
  ORDER BY h.id, r.prio
)
UPDATE public.products p
SET category_id = c.id
FROM best b
JOIN public.categories c
  ON lower(c.name) = lower(b.cat_name)
 AND c.parent_id IS NOT NULL
 AND c.warehouse_id = b.warehouse_id   -- cada producto, a una categoría de SU almacén
WHERE p.id = b.product_id;

-- Lo que no encajó en ninguna regla va a «Otros accesorios», para que no quede
-- nada suelto en «Sin categoría».
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
JOIN public.categories parent ON parent.id = c.parent_id
WHERE p.category_id IS NULL
  AND c.warehouse_id = p.warehouse_id
  AND lower(c.name) = 'otros accesorios'
  AND lower(parent.name) = 'accesorios';

-- ─────────────────────────────────────────────
-- 4. Revisión: qué ha quedado en cada categoría
-- ─────────────────────────────────────────────
--   SELECT coalesce(parent.name, '—') AS principal,
--          coalesce(c.name, 'SIN CATEGORÍA') AS subcategoria,
--          count(p.id) AS productos
--   FROM public.products p
--   LEFT JOIN public.categories c ON c.id = p.category_id
--   LEFT JOIN public.categories parent ON parent.id = c.parent_id
--   GROUP BY 1, 2
--   ORDER BY 1, 2;

-- ─────────────────────────────────────────────
-- 5. OPCIONAL — reclasificar TODO desde cero
--    Descomenta y ejecuta SOLO si quieres tirar la clasificación manual
--    existente y dejar que las reglas de arriba decidan por todos los productos.
--    Luego vuelve a ejecutar este archivo entero.
-- ─────────────────────────────────────────────
--   UPDATE public.products SET category_id = NULL;
