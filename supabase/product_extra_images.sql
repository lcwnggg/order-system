-- Varias fotos por producto
--
-- Hay productos casi idénticos (mismo modelo, detalle distinto) y con una sola
-- foto no se distinguen. `image_url` se queda como la foto de portada —la que
-- sale en las listas, el carrito y los pedidos— y las demás van aquí.
--
-- Idempotente: se puede ejecutar varias veces sin romper nada.

alter table products
  add column if not exists image_urls text[] not null default '{}'::text[];

comment on column products.image_urls is
  'Fotos adicionales del producto (sin la portada, que sigue en image_url).';
