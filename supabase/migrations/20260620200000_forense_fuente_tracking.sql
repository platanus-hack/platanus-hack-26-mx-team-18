-- Rastreo de origen para la tabla forense.
-- Como el proyecto agrega datos de MUCHAS fuentes distintas, necesitamos
-- saber de dónde salió cada registro y cuál era su ID original en esa fuente.
--
--   fuente     -> nombre de la fuente, ej: 'ijcf_jalisco'
--   fuente_id  -> el ID que la fuente le da al registro, ej: '41956'
--
-- La restricción UNIQUE(fuente, fuente_id) nos deja hacer "upsert":
-- si volvemos a correr el scraper, en vez de duplicar, actualiza el registro.
-- NOTA: en Postgres los NULL se consideran distintos entre sí, por eso los
-- registros viejos (sin fuente) no chocan con esta restricción.

alter table public.forense
  add column fuente    text,
  add column fuente_id text;

alter table public.forense
  add constraint forense_fuente_unica unique (fuente, fuente_id);

comment on column public.forense.fuente    is 'Origen del dato, ej: ijcf_jalisco';
comment on column public.forense.fuente_id is 'ID del registro en la fuente original';
