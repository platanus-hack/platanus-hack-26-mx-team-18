-- Desglosamos la ubicación de la tabla `lugares` en estado y municipio.
--
-- Antes `lugares` era solo { id, lugar } con un texto suelto que cada fuente
-- escribía a su manera ("GUADALAJARA, JALISCO" en RNPDNO, el nombre de la
-- delegación IJCF en Jalisco). Eso hacía imposible cruzar por ubicación entre
-- fuentes, porque los textos nunca coincidían.
--
-- Con `estado` separado podemos comparar en el motor de coincidencias a nivel
-- estado (ver lib/matching/score.ts). `municipio` se guarda cuando la fuente lo
-- da limpio (RNPDNO sí; IJCF Jalisco no), pero NO se usa para puntuar todavía.
--
--   estado     -> ej: 'Jalisco'      (RNPDNO lo da; en IJCF siempre es Jalisco)
--   municipio  -> ej: 'Guadalajara'  (solo RNPDNO; null en IJCF)
--
-- Para llenar estas columnas en datos ya scrapeados, basta re-correr los
-- scrapers: hacen backfill de las filas viejas que tengan estado en null.

alter table public.lugares
  add column estado    text,
  add column municipio text;

comment on column public.lugares.estado    is 'Estado de la república, ej: Jalisco';
comment on column public.lugares.municipio is 'Municipio dentro del estado, ej: Guadalajara';
