-- Motor de coincidencias v2: score normalizado (0..1) + desglose auditable.
--
-- El cruce persona<->forense ya no guarda solo un "puntaje" 0-100 con una razón
-- en texto: ahora calcula un score 0..1 (promedio ponderado SOLO de los campos
-- realmente comparables entre las dos fuentes) y, para poder auditar a mano POR
-- QUÉ salió ese número, guarda el desglose campo por campo.
--
--   score     -> 0..1   (1 = match casi seguro). Promedio ponderado de los
--                        campos comparables; un campo no comparable se EXCLUYE,
--                        no cuenta como 0 ni como neutral.
--   desglose  -> jsonb   { sexo: {comparable, similitud, explicacion}, edad: {...}, ... }
--
-- `puntaje` (0-100) y `razon` se siguen llenando (score*100 y un resumen corto)
-- por compatibilidad con lo que ya lee el front.
--
-- El índice único (forense_id, persona_id) hace el proceso IDEMPOTENTE: re-correr
-- el cruce hace upsert sobre el mismo par en vez de duplicarlo.

alter table public.coincidencias
  add column if not exists score    numeric(6, 5),
  add column if not exists desglose jsonb;

-- Idempotencia del cruce: el upsert usa ON CONFLICT (forense_id, persona_id),
-- que necesita un índice/constraint único sobre esas columnas. En doc/schema.sql
-- ya existe `UNIQUE (forense_id, persona_id)`, pero la tabla pudo crearse fuera
-- de estas migraciones, así que lo creamos SOLO si todavía no hay ningún índice
-- único que cubra ese par (evitamos un índice duplicado y redundante).
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
    where n.nspname = 'public'
      and c.relname = 'coincidencias'
      and i.indisunique
      and a.attname in ('forense_id', 'persona_id')
    group by i.indexrelid
    having count(distinct a.attname) = 2
  ) then
    create unique index coincidencias_par_unico
      on public.coincidencias (forense_id, persona_id);
  end if;
end $$;

comment on column public.coincidencias.score    is 'Probabilidad de match 0..1 (promedio ponderado de campos comparables)';
comment on column public.coincidencias.desglose is 'Desglose por campo {comparable, similitud, explicacion} para auditar el score';
