-- «New in»: el escaparate de novedades
--
-- El almacén decide qué producto es novedad (al añadirlo o después, desde la
-- lista). Lo que se guarda no es un "sí/no" sino la fecha en la que deja de
-- serlo: así el producto sale solo del apartado cuando toca, sin que nadie
-- tenga que acordarse de quitarlo ni hacer falta ninguna tarea programada.
--
-- Idempotente: se puede ejecutar varias veces sin romper nada.

alter table products
  add column if not exists new_until timestamptz;

comment on column products.new_until is
  'Fin del periodo de novedad. El producto sale en «New in» mientras new_until > now(); null = no es novedad.';

-- El catálogo pregunta constantemente «¿cuáles siguen siendo novedad?».
-- Parcial: las filas sin novedad (la mayoría con el tiempo) no ocupan índice.
create index if not exists products_new_until_idx
  on products (new_until desc)
  where new_until is not null;
